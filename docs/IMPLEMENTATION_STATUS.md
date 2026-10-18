# Implementation Status — PeopleFlow HR (KHR)

Date: 2026-10-18
Branch: `remediation/audit-2026-10` @ `7aba71d` (not yet merged/deployed)
Production: `main` lineage deployed at https://khr.ng

## 1. Phase progress (vs `development-checklist.md`)

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Foundation + Core HR | Monorepo, Docker, CI, auth/MFA/RBAC, multi-tenancy + isolation tests, employees, org, leave, attendance, self-onboarding, audit, worker, web app | **Complete** |
| 3 — Payroll (pulled forward) | Nigerian tax engine, statutory deductions, run lifecycle, payslips, bank export, attestation | **Complete**, hardened in this remediation (versioning, SoD, reconciliation) |
| 2 — Recruitment & offboarding | Requisitions, job board, pipeline, interviews, offers, offboarding checklists | **Not started** |
| 4 — Performance & L&D | Goals/OKRs, review cycles, training catalog | **Not started** |
| 5 — Platform & monetization | Platform-admin console UI, plans/billing, per-tenant limits, NDPR data export | **Not started** (platform listing API exists) |

## 2. Remediation branch (this audit)

| Commit | Change | Status |
| --- | --- | --- |
| `3cc846c` | Pre-audit checkpoint: light theme, dashboard stats, HTML emails, MFA QR, company sectors, subdomain API groundwork | ✅ |
| `fe2d523` | **P0a** — versioned Nigerian tax engine (PITA FA2020 + NTA 2025), Decimal money path, attestation/finalization gate | ✅ |
| `c77f6d3` | **P0b** — fail-closed Postgres RLS, non-owner runtime role, scoped client factories, 14-test adversarial proof | ✅ |
| `4b3659e` | **P1** — `/docs` 404 fixed (redirect to proxied Swagger UI) | ✅ |
| `61bbb20` | **P1** — payroll maker–checker SoD, reconciliation gate, submitter/payer attribution, 17-test e2e | ✅ |
| `7aba71d` | **P1** — leave & attendance workflow e2e suite (28 tests) | ✅ |

Evidence: 68 unit + 79 e2e tests green (e2e in both owner and `khr_app` credential modes), typecheck clean across 6 projects — see `TEST_RESULTS.md`.

## 3. In flight / parked

- **Per-company subdomains (`acme.khr.ng`)** — API groundwork shipped (public workspace lookup, base-domain origin allowance, slug validation/reserved list). Parked: login/web wiring, cookie-domain rollout, wildcard TLS + nginx, deploy env (`A4–A6` of the subdomain plan). Resumes after remediation sign-off.
- **Deployment of this branch** — remediation commits are local to `remediation/audit-2026-10`; PR + deploy are the next steps.

## 4. Not built (P2 backlog, priority order proposal)

1. **Recruitment/ATS** — requisitions → public postings → candidate pipeline → interviews/scorecards → offers (feeds existing onboarding).
2. **Document vault** — employee/company documents with per-document ACLs, versioning, object storage.
3. **Reporting** — headcount/leave/payroll report builder with scheduled CSV/PDF export (bank CSV + employee CSV exist today).
4. **Performance** — goal setting, review cycles, manager/peer reviews.
5. **Training/L&D** — catalog, enrollment, completion tracking.
6. **Billing** — plans, metering, invoicing (Paystack/Stripe), per-tenant limits.
7. **Platform-admin console UI** — tenant management on top of the existing platform API scope.

## 5. Production-readiness gate (unchecked items)

- Managed Postgres + Redis with backups/PITR
- Error tracking + metrics (currently structured logs only)
- Load testing of auth/attendance hot paths
- External penetration test (tenant isolation focus)
- Incident-response runbook
- Dependency/image scanning in CI
