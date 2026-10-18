# Audit Report — PeopleFlow HR (KHR)

Date: 2026-10-18
Branch: `remediation/audit-2026-10`
Auditor baseline: commit `3cc846c` (pre-remediation checkpoint)
Remediation head: commit `7aba71d`

## 1. Scope

Full-stack review of the KHR multi-tenant HR platform:

- `apps/api` — NestJS API (auth, tenancy, employees, org, leave, attendance, payroll, audit, stats, platform)
- `apps/web` — Next.js console and landing page
- `apps/worker` — BullMQ email/maintenance worker
- `packages/database` — Prisma schema, migrations, Postgres RLS, scoped client factories
- `packages/types` — shared Zod schemas and the RBAC permission matrix
- Deployment surface (Docker Compose, nginx proxy, production env wiring) reviewed for the findings below; infrastructure changes were out of scope except where a finding required them.

Methodology: manual code review, schema/migration review, live probes against the production deployment (read-only), and construction of an adversarial end-to-end test suite executed under the production database role (`khr_app`, non-owner) to prove isolation properties rather than assume them.

## 2. Findings summary

| ID | Severity | Finding | Status | Fix commit |
| --- | --- | --- | --- | --- |
| F-01 | **P0** | Payroll tax engine unversioned; no statutory-regime cutover control; no human attestation before finalizing runs | **Fixed** | `fe2d523` |
| F-02 | **P0** | Row-level security was fail-open: a request that reached the DB without tenant context could read/write across tenants; the app connected as the table owner (RLS bypass) | **Fixed** | `c77f6d3` |
| F-03 | P1 | Advertised API documentation URL (`/docs`) returned 404 in production | **Fixed** | `4b3659e` |
| F-04 | P1 | No segregation of duties in payroll: the same user could prepare, submit, approve and pay a run; no reconciliation of payslip sums against run totals; no attribution of submitter/payer | **Fixed** | `61bbb20` |
| F-05 | P1 | Integration-test coverage gaps: leave and attendance workflows (balance math, approval SoD, correction review) had no end-to-end tests | **Fixed** | `7aba71d` |
| F-06 | P2 | Missing HR modules relative to the product roadmap: recruitment/ATS, performance, training/L&D, document vault, report builder, billing, platform-admin UI | **Open** (tracked) | — |
| F-07 | P2 | Production-readiness gate items unchecked (managed Postgres/Redis, error tracking, load testing, external pen-test, incident runbook) | **Open** (tracked) | — |

## 3. Finding details

### F-01 (P0) — Unversioned tax engine, no regime cutover, no attestation

**Risk.** Nigeria replaced PITA (as amended by the Finance Act 2020) with the Nigeria Tax Act 2025 effective 1 January 2026. Without period-based regime selection, version stamping, and a human sign-off gate, runs could silently be computed under the wrong statute, and a code change to tax parameters would silently change payroll output.

**Remediation (`fe2d523`).**
- `apps/api/src/payroll/nigeria-tax.ts`: versioned dual-regime engine — `PITA_FA2020@v1` (periods ≤ Dec 2025) and `NTA_2025@v1` (periods ≥ Jan 2026), selected by `regimeForPeriod(year)`.
- Every run stamps `taxRegime` + `engineVersion` at compute time.
- Finalization gate: approval fails with `TAX_ENGINE_STALE` if the stamped version no longer matches the engine, and `TAX_RULES_NOT_APPROVED` until an authorized user attests the exact version via `POST /payroll/settings/approve-tax-rules` (recorded on `PayrollSettings.taxRulesApprovedVersion`, audited).
- All monetary math moved to `Prisma.Decimal` end-to-end (no float conversions), annual-first computation, half-up rounding to 2dp.
- 270-line unit spec (`nigeria-tax.spec.ts`) covering bands, reliefs, minimum-wage exemption, PITA minimum tax, rent relief cap, and rounding.

See `docs/PAYROLL_COMPLIANCE.md` for the statutory mapping.

### F-02 (P0) — Fail-open row-level security

**Risk.** Tenant isolation relied on application-level filters plus RLS policies that were permissive when the per-request tenant GUC was unset — and the API connected to Postgres as the table owner, which bypasses non-forced RLS entirely. Any missed filter or unscoped query was a cross-tenant read/write primitive.

**Remediation (`c77f6d3`).**
- Runtime connects as non-owner role `khr_app`; the owner role is used only for migrations/seed (`MIGRATE_DATABASE_URL`).
- Migration `20261018174752_rls_fail_closed`: GUC helper functions (`app_company_id()`, `app_user_id()`, `app_scope()` — empty string coerces to NULL, which every policy rejects) and a strict policy matrix across 22 tenant tables:
  - `tenant_isolation`: `"companyId" = app_company_id()` (USING + WITH CHECK) — no context ⇒ no rows, no writes.
  - `platform_read`: SELECT-only when `app.scope = 'platform'`.
  - `auth_member_read` (Membership): SELECT-only, own rows, `app.scope = 'auth'`.
  - `audit_insert` (AuditLog): INSERT-only under `app.scope = 'audit'`.
- `packages/database/src/tenant.ts`: scoped client factories (`tenantClient`, `authClient`, `auditClient`, `platformClient`) that pin the GUCs transaction-locally (`set_config(..., true)`) and additionally inject `companyId` filters/values at the Prisma layer (defense in depth).
- Proof: `apps/api/test/rls-fail-closed.e2e-spec.ts` (14 tests) runs as `khr_app` and demonstrates default-deny, cross-tenant invisibility, smuggled-`companyId` overwrite, re-homing rejection, and scope confinement. The entire e2e suite (79 tests) also runs green under `khr_app` credentials.

### F-03 (P1) — API docs 404

`https://khr.ng/docs` 404'd because Swagger UI is served by the API behind the `/api/*` proxy. Fixed with a Next.js redirect `/docs → /api/docs` (`apps/web/next.config.mjs`); asset and `docs-json` paths verified working through the proxy.

### F-04 (P1) — Payroll workflow controls

**Risk.** A single `COMPANY_ADMIN` could create, submit, approve and mark a run paid; payslips could be altered after compute without detection; runs carried no record of who submitted or paid them.

**Remediation (`61bbb20`).**
- **Maker–checker SoD**: the approver must differ from both the run's creator and submitter (user-id level, role-independent); violation → 403 `PAYROLL_SOD_VIOLATION`.
- **Reconciliation gate**: at approval, all 10 run totals are re-derived from payslip aggregates and must match exactly (`Decimal.equals`); drift → 409 `RECONCILIATION_MISMATCH`; empty runs → 400 `EMPTY_RUN`.
- **Attribution**: `createdById` / `submittedById` / `approvedById` / `paidById` with timestamps on `PayrollRun` (migration `20261018200945_payroll_sod_attribution`); rejection clears the submitter.
- Proof: `payroll-workflow.e2e-spec.ts` (17 tests) covering the full state machine, both SoD directions, the attestation gate, tamper detection, bank-CSV export rules, and the audit trail.

### F-05 (P1) — Integration-test gaps

Added `leave-attendance.e2e-spec.ts` (28 tests): working-day math (weekend/holiday exclusion), overlap and balance checks at request time, approver SoD (no self-decision), balance deduction only on approval with refund on cancelling approved leave, manual adjustments, calendar scoping, clock-in/out state machine with deterministic late detection, correction validation and reviewer SoD, record materialization from approved corrections, cross-tenant invisibility, and full audit-action coverage.

### F-06 / F-07 (P2) — Open items

Tracked in `docs/IMPLEMENTATION_STATUS.md` (module gaps) and `docs/SECURITY_REVIEW.md` §6 (operational hardening). None of these block the current feature set; they gate the next product phases and a production SLA.

## 4. Verification evidence

Full details in `docs/TEST_RESULTS.md`. Headline numbers at `7aba71d`:

- Unit tests: **68/68** (API 53, shared types 15)
- End-to-end tests: **79/79** across 4 suites — executed under **both** the owner role and the production `khr_app` role (fail-closed RLS active)
- Typecheck: **6/6** workspace projects clean
- All payroll/leave/attendance mutations leave tenant-readable audit rows (asserted per action string in the e2e suites)
