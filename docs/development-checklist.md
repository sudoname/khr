# Development Checklist & Roadmap

## Phase 1 — Foundation + Core HR (this delivery)

- [x] Monorepo scaffold (pnpm + Turborepo), strict TS, shared tsconfig
- [x] Docker Compose dev stack: Postgres 16 (host 5434), Redis 7 (6380), Mailhog (8025)
- [x] Prisma schema + migrations, including Postgres Row-Level Security policies
- [x] Idempotent demo seed (platform admin, Acme Nigeria Ltd, 8 employees, leave setup, holidays)
- [x] Auth: register (company + admin), email verification, Argon2id, DB-backed revocable sessions, password reset/change, rate limiting, enumeration-resistant flows
- [x] TOTP MFA + recovery codes; enforced for privileged roles at the guard
- [x] RBAC permission matrix in `@peopleflow/types`, global guards, no client role selection
- [x] Multi-tenancy: memberships, company switcher, invites (72h token), last-admin protection
- [x] Employees CRUD + field-level restriction of salary/BVN/bank data
- [x] Departments (tree + cycle prevention), Locations, Org chart (reporting-cycle prevention)
- [x] Leave: configurable types/policies/balances, working-day calc with holidays, approvals
- [x] Attendance: UTC server timestamps, duplicate prevention, correction requests
- [x] Employee self-onboarding: wizard (gender/BVN/bank/terms acceptance), HR review/approve/reject
- [x] Audit log on sensitive actions incl. platform-admin access
- [x] Worker: BullMQ email + maintenance jobs
- [x] Web app: auth flows, shell, people/org/leave/attendance/onboarding/settings UIs
- [x] Tests: unit (leave days, org cycles, permission matrix) + e2e (tenant isolation, onboarding)
- [x] CI (GitHub Actions), Dockerfiles, documentation

## Phase 2 — Recruitment & Onboarding/Offboarding

- [ ] Job requisitions + approval chain
- [ ] Public job board + application intake (CV upload to object storage)
- [ ] Pipeline stages, interview scheduling, scorecards, offer letters
- [ ] Convert hire → employee; structured onboarding/offboarding task checklists
- [ ] Document management with access control

## Phase 3 — Payroll (Nigeria-first)

- [ ] Configurable earnings/deductions, effective-dated NG PAYE tax tables (not hardcoded)
- [ ] Pension (employee/employer), NHF; payroll runs: draft → review → approve → lock
- [ ] Payslip generation + employee portal access
- [ ] Bank schedule export

## Phase 4 — Performance & L&D

- [ ] Goals/OKRs, review cycles, manager + self reviews
- [ ] Training catalog, enrollment, completion tracking

## Phase 5 — Platform & Monetization

- [ ] Platform-admin console (tenant management, usage)
- [ ] Plans/billing, per-tenant limits
- [ ] Data export per tenant (GDPR/NDPR)

## Production-readiness gate (before any deploy)

- [ ] `SESSION_SECRET` set (32+ random bytes), `SECURE_COOKIES=1`, HTTPS termination
- [ ] Real SMTP provider (replace Mailhog), SPF/DKIM
- [ ] Managed Postgres with backups + PITR; Redis persistence/eviction policy reviewed
- [ ] `NODE_ENV=production`, seed script disabled, platform-admin credentials rotated
- [ ] Error tracking + metrics (e.g. Sentry / OpenTelemetry), log shipping
- [ ] Dependency audit (`pnpm audit`) and image scanning in CI
- [ ] Load test auth + attendance clock-in paths; verify rate limits
- [ ] Pen-test pass on tenant isolation (attempt cross-tenant access with real tokens)
- [ ] Incident runbook: session mass-revocation, token invalidation, DB restore drill
