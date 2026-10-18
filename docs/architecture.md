# Architecture

## Monorepo layout

```
apps/
  web/        Next.js 14 (App Router) — auth flows, app shell, module UIs
  api/        NestJS REST API — OpenAPI at /docs, pino logs, Zod validation
  worker/     BullMQ consumers — email delivery (SMTP/Mailhog), maintenance jobs
packages/
  types/      Shared Zod schemas + the RBAC permission matrix (single source of truth)
  database/   Prisma schema, migrations, tenant-scoped client extension, seed
  config/     Shared tsconfig
infrastructure/
  docker/     api / worker / web Dockerfiles (used by docker-compose --profile apps)
docs/         This documentation
hr-platform/  Legacy Flask prototype (read-only reference, not part of the build)
```

Tooling: pnpm workspaces + Turborepo (`dev`, `build`, `test`, `typecheck` pipelines). Node 20, TypeScript strict.

## Multi-tenancy (defense in depth)

Single PostgreSQL database, shared schema, `companyId` on every tenant-owned table. Four independent layers enforce isolation:

1. **AuthGuard** (`apps/api/src/common/guards/auth.guard.ts`) — on every request, re-verifies the session's `activeCompanyId` against a live `Membership` row. Stale or revoked access fails closed.
2. **Request context** — `nestjs-cls` (AsyncLocalStorage) carries the actor (`userId`, `companyId`, `role`, `employeeId`) so services never accept tenant IDs from request bodies.
3. **Tenant-scoped Prisma client** (`packages/database/src/tenant.ts`) — `prisma.tenant(companyId)` is an extension that injects `companyId` into every query on tenant models; services additionally set `companyId` explicitly on `create`.
4. **Postgres Row-Level Security** — migration `20261018004735_rls_policies` enables RLS with policies keyed on a per-transaction `app.company_id` setting, so even raw SQL cannot cross tenants.

`apps/api/test/tenant-isolation.e2e-spec.ts` creates two companies and asserts cross-tenant reads/writes fail for every module.

Multi-company users: `Membership(userId, companyId, role)` with a unique `[userId, companyId]`; sessions pin an `activeCompanyId`, switched via `POST /auth/switch-company` (validated against memberships).

## Authentication

- **Passwords**: Argon2id. Login uses a dummy-hash comparison when the user doesn't exist (timing-safe, enumeration-resistant).
- **Sessions**: opaque 32-byte tokens; only a SHA-256 hash is stored (`Session.tokenHash`). Cookie is `httpOnly`, `SameSite=Lax`, `Secure` when `SECURE_COOKIES=1`. Sessions are listable and revocable per device.
- **Email verification** is required before first login. Verify / reset / invite / MFA-challenge flows all use single-use, expiring, SHA-256-hashed `SecurityToken` rows.
- **MFA**: TOTP (otplib) plus 8 one-time recovery codes (hashed at rest). Enforced at the guard for privileged roles (`MFA_REQUIRED_ROLES`) when `enforceMfaForPrivileged` is on — a privileged user without MFA gets `403 { code: 'MFA_SETUP_REQUIRED' }` and can only reach the MFA-setup endpoints.
- **Rate limiting**: Redis fixed-window counters on login (per-IP and per-email), register, and forgot-password.
- **CSRF**: `SameSite=Lax` cookie + an Origin-check middleware that rejects mutating requests from non-allowlisted origins.

## Authorization (RBAC)

Roles: `PLATFORM_ADMIN` (flag on User, cross-tenant, audited) and company roles `COMPANY_ADMIN`, `HR_ADMIN`, `HR_MANAGER`, `DEPT_MANAGER`, `RECRUITER`, `PAYROLL_OFFICER`, `EMPLOYEE`.

- The permission matrix lives in `packages/types/src/roles.ts` (`roleHas(role, permission)`) and is unit-tested.
- Controllers declare `@RequirePermission('...')`; a global `PermissionsGuard` enforces it. There is **no client-side role selection** — role comes from the membership row.
- Field-level restrictions: salary (`Compensation`), BVN and bank details are only returned to the employee themself or holders of `compensation.read`; enforced in the employee serializer, not the client.
- Guard order: `AuthGuard` → `PermissionsGuard` (both global `APP_GUARD`s).

## Domain model highlights

- **Employee** — profile, employment type/status, `managerId` (org chart), department/location, onboarding lifecycle (`NOT_SUBMITTED → SUBMITTED → APPROVED/REJECTED`) with reviewer + note, `termsAcceptedAt`.
- **Org chart** — reporting-cycle prevention via `createsReportingCycle()` (`apps/api/src/org/org-cycle.ts`, unit-tested); department tree with the same walk-up cycle check.
- **Leave** — configurable `LeaveType`/`LeavePolicy` per company (law is configuration, not code), `LeaveBalance` per cycle, overlapping-request and balance checks, approval trail, working-day calculation that respects weekends + company `Holiday`s (unit-tested in `leave-days.util.spec.ts`).
- **Attendance** — server-side timestamps only, stored UTC; `@@unique([employeeId, day])` prevents duplicate clock-ins; corrections go through an approval model (`AttendanceCorrection`) rather than editing records.
- **Money** — `Decimal(18,2)`, currency code on Company (NGN default). No floats anywhere.
- **Audit** — append-only `AuditLog` (actor, company, action, entity, metadata, IP) written by services via `AuditService`; platform-admin actions are always audited.

## Operational concerns

- **Jobs**: API enqueues to BullMQ (Redis); `apps/worker` sends email (Mailhog in dev) and runs maintenance (expired session/token pruning). Email is never sent inline with a request.
- **Logging**: pino-http with redaction of cookies/authorization headers; pretty-printed in dev.
- **Docs**: Swagger UI at `http://localhost:4000/docs`.
- **CI** (`.github/workflows/ci.yml`): pnpm install → prisma generate → typecheck → unit tests → migrate deploy against service containers → e2e → build.
- **Docker**: `docker-compose.yml` runs Postgres (host port **5434**), Redis (**6380**), Mailhog (8025 UI); `--profile apps` additionally builds and runs api/worker/web from `infrastructure/docker/*.Dockerfile`.
