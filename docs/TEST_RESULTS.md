# Test Results — PeopleFlow HR (KHR)

Date: 2026-10-18
Branch: `remediation/audit-2026-10` @ `7aba71d`
Environment: local docker-compose stack (Postgres 16 @ 5434, Redis 7 @ 6380, Mailhog @ 8025), Node 20, pnpm workspace

## 1. Summary

| Check | Result |
| --- | --- |
| Unit tests | **68 / 68 pass** (6 suites) |
| End-to-end tests | **79 / 79 pass** (4 suites) — run in **both** database credential modes (see §3) |
| Typecheck (`tsc --noEmit`) | **6 / 6 projects clean** (api, web, worker, database, types + root scope) |
| Production build (`pnpm -r build`) | **Pass** (api, web, worker, packages) |

## 2. Unit tests

Command: `pnpm -r --if-present test`

| Suite | Package | Tests | Covers |
| --- | --- | --- | --- |
| `payroll/nigeria-tax.spec.ts` | apps/api | — | Both tax regimes: band arithmetic, CRA, PITA 1% minimum tax, NTA rent-relief cap, minimum-wage exemptions, deduction eligibility, rounding |
| `leave/leave-days.util.spec.ts` | apps/api | — | Working-day math: weekends, holidays, half-days, single-day edge cases |
| `org/org-cycle.spec.ts` | apps/api | — | Department/manager cycle prevention |
| `common/csv.spec.ts` | apps/api | — | CSV parse/serialize (import/export, bank schedule) |
| `common/image-sniff.spec.ts` | apps/api | — | Upload content sniffing (logo/avatar) |
| `schemas` (incl. MFA role policy, onboarding NUBAN/BVN) | packages/types | 15 | Zod schema validation + RBAC/MFA policy |
| **Total** | | **68** | |

(apps/api: 53 tests across 5 suites; packages/types: 15 tests.)

## 3. End-to-end tests — dual credential modes

Command (per mode): `pnpm exec jest --config test/jest-e2e.json --runInBand --forceExit` (from `apps/api`)

The suite is executed twice:

1. **Owner mode** — `DATABASE_URL` = table-owner role (`peopleflow`). Validates application behavior independent of RLS.
2. **Fail-closed mode** — `DATABASE_URL` = **`khr_app`**, the non-owner production runtime role, with `OWNER_DATABASE_URL` provided only for fixture setup/teardown. Every application query in every test runs against **active, fail-closed row-level security**. This is the mode that proves the isolation claims.

Both modes: **4 suites, 79 / 79 pass.**

| Suite | Tests | What it proves |
| --- | --- | --- |
| `rls-fail-closed.e2e-spec.ts` | 14 | As `khr_app` with no tenant context: zero rows readable, inserts rejected by policy, updates/deletes affect 0 rows. Tenant client: scoped reads, cross-tenant update → not-found, smuggled `companyId` overwritten, re-homing rejected by WITH CHECK, transaction-local scoping. Auth scope: own memberships only, SELECT-only. Audit scope: INSERT-only, no read-back. Platform scope: cross-tenant SELECT, zero writes. |
| `tenant-isolation.e2e-spec.ts` | 20 | Two live tenants cannot see or mutate each other's employees, members, settings or workflows through any API route; full self-onboarding flow (invite → wizard → HR review → terms). |
| `payroll-workflow.e2e-spec.ts` | 17 | Run lifecycle (DRAFT → PENDING_APPROVAL → APPROVED → PAID) with atomic from-state guards; duplicate-period rejection; cross-tenant 404s; maker–checker SoD in both directions (`PAYROLL_SOD_VIOLATION`); tax attestation gate (`TAX_RULES_NOT_APPROVED` → approve → pass); payslip tamper detection (`RECONCILIATION_MISMATCH`); frozen approved runs; bank CSV export rules; submitter/approver/payer attribution; employee payslip self-service; reject-with-note path; all 8 payroll audit actions present. |
| `leave-attendance.e2e-spec.ts` | 28 | Leave setup permissions; balance seeding from policy; working-day computation (weekend + holiday exclusion → 4 days across a 5-day span); inverted-range/overlap/over-balance rejections; request-for-others permission; cross-tenant invisibility; approver SoD (no self-decision); balance deducted only on approval, refunded on cancelling approved leave, untouched on rejection; manual adjustments (permission-gated, 2.5-day delta reflected); calendar shows approved leave only; attendance policy permissions; clock-out-before-in rejection; single clock-in/out with deterministic late detection; permission-scoped record listing; correction validation (ordering, future day, duplicate pending); reviewer SoD (no self-review); correction approval materializes a `CORRECTION`-source record; rejection changes nothing; all 13 leave/attendance audit actions present. |

### Reproduction (fail-closed mode)

```bash
cd apps/api
DATABASE_URL="postgresql://khr_app:<pw>@localhost:5434/peopleflow" \
OWNER_DATABASE_URL="postgresql://peopleflow:<pw>@localhost:5434/peopleflow" \
pnpm exec jest --config test/jest-e2e.json --runInBand --forceExit
```

Observed output (2026-10-18):

```
PASS test/leave-attendance.e2e-spec.ts
PASS test/payroll-workflow.e2e-spec.ts
PASS test/tenant-isolation.e2e-spec.ts
PASS test/rls-fail-closed.e2e-spec.ts
Test Suites: 4 passed, 4 total
Tests:       79 passed, 79 total
```

## 4. Static checks

- `pnpm -r --if-present typecheck` — all projects pass with no errors.
- `pnpm -r --if-present build` — API (Nest), web (Next 14, all routes compile incl. `/docs` redirect), worker and packages build cleanly.

## 5. Known test-infrastructure notes

- E2e suites require the docker-compose dev stack and applied migrations; they create throwaway tenants (timestamped emails) and clean up in `afterAll`.
- Jest is run with `--forceExit` (Nest + Redis leave open handles after `app.close()`).
- The late-detection test is deterministic by setting the attendance policy to a 00:00 start / zero grace / 7-day work week before clocking in.
