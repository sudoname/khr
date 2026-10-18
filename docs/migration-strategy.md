# Migration Strategy

## 1. Legacy data migration (Flask/SQLite → PostgreSQL)

**Outcome: not required.** The assessment (`assessment.md`) found no `hr.sqlite3` file in the repository or working tree — the prototype was never run with persistent data in this repo. The rewrite therefore carries zero data-loss risk.

### Contingency plan (had data existed)

Documented for completeness, and applicable if a deployed instance of the Flask app surfaces later:

1. **Freeze & snapshot** — stop the Flask app, copy `hr.sqlite3`, record row counts per table.
2. **Extract** — a one-off Node script reads SQLite (`better-sqlite3`) and maps legacy tables to Prisma models:
   - `companies` → `Company` (generate slug, default `NGN`/`Africa/Lagos`)
   - `users` → `User` + `Membership(role=COMPANY_ADMIN)`; legacy password hashes are not portable → create accounts unverified and send password-reset invites
   - `employees` → `Employee` (+ `Compensation` from salary column, converting float → `Decimal` with explicit rounding review)
   - `leave_requests` → `LeaveType` ("Annual" default) + `LeaveRequest`; status strings mapped to the enum
   - `attendance` → `AttendanceRecord` (localtime → UTC using the company timezone; collapse duplicates, keeping earliest-in/latest-out, logging each collapse)
   - recruitment/payroll drafts → exported to CSV and parked until the ATS/payroll phases
3. **Load** — insert inside a single transaction per company via the tenant-scoped client; write an `AuditLog` entry `data.migrated` with source row counts.
4. **Verify** — row-count reconciliation, spot-check N random employees, re-run leave-balance derivation and compare.
5. **Cut over** — legacy app placed in read-only mode, then archived. Rollback = drop the imported company rows (tenant-scoped delete) and restore the snapshot.

## 2. Schema migration workflow (ongoing)

- Prisma Migrate is the only mechanism for schema change. Never edit the database by hand.
- Local: `pnpm db:migrate` (creates + applies a named migration, regenerates the client).
- CI/production: `pnpm db:deploy` (`prisma migrate deploy`) — applies committed migrations only; the API Docker image also runs it on boot.
- Migrations are additive-first: add nullable column → backfill → tighten constraints in a follow-up migration. Destructive changes require an explicit backfill/rollback note in the migration directory.
- Raw SQL migrations are used where Prisma lacks syntax (e.g. `20261018004735_rls_policies` for Row-Level Security). RLS policies must be updated in the same migration as any new tenant-owned table.
- Seeding (`pnpm db:seed`) is idempotent (upserts keyed on natural identifiers) and dev-only; it must never run against production.

## 3. Phase rollout

Features ship behind completed phases rather than flags (see `development-checklist.md`):

- **Phase 1 (done)** — foundation, auth/MFA, tenancy + RLS, employees, org, leave, attendance, self-onboarding.
- **Phase 2** — ATS + full onboarding/offboarding checklists. New tables only; no changes to Phase 1 tables expected.
- **Phase 3** — payroll (NG PAYE as *configurable* tax tables with effective dates, never hardcoded rates), payslips.
- **Phase 4** — performance + L&D.
- **Phase 5** — platform-admin console, billing/plans.

Each phase lands as: migration(s) → API module + permissions added to the matrix → isolation tests extended → UI.
