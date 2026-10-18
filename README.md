# PeopleFlow HR

Multi-tenant HR management platform (Nigeria-first). Phase 1 delivers the foundation and core HR: authentication with MFA, strict tenant isolation, employees, departments & org chart, leave, attendance, and employee self-onboarding.

- **Web**: Next.js 14 (App Router, Tailwind)
- **API**: NestJS + Prisma + Zod (Swagger at `/docs`)
- **Worker**: BullMQ (email, maintenance)
- **Data**: PostgreSQL 16 (with Row-Level Security), Redis 7

See `docs/architecture.md` for design details, `docs/assessment.md` for the legacy-prototype assessment, `docs/migration-strategy.md`, and `docs/development-checklist.md` for the roadmap.

## Quickstart (local dev)

Prerequisites: Node 20+, pnpm 10 (`corepack enable`), Docker.

```bash
# 1. Infra: Postgres (localhost:5434), Redis (6380), Mailhog (http://localhost:8025)
docker compose up -d

# 2. Env + deps
cp .env.example .env
pnpm install

# 3. Database
pnpm db:generate     # prisma client
pnpm db:deploy       # apply migrations
pnpm db:seed         # demo data (idempotent, dev only)

# 4. Run everything (web :3000, api :4000, worker)
pnpm dev
```

Open http://localhost:3000. API docs: http://localhost:4000/docs. Outbound email lands in Mailhog: http://localhost:8025.

Alternatively, run the apps in containers too: `docker compose --profile apps up --build`.

## Demo logins (from seed)

Password for all Acme users: `Peopleflow-Demo-1!`

| Email | Role |
| --- | --- |
| adaeze.okafor@acme.ng | COMPANY_ADMIN |
| ngozi.eze@acme.ng | HR_ADMIN |
| amina.bello@acme.ng | HR_MANAGER |
| ibrahim.musa@acme.ng | DEPT_MANAGER |
| chidi.nwosu@acme.ng | EMPLOYEE |

Platform admin: `root@peopleflow.local` / `ChangeMe-Please-123!` (dev only — rotate everywhere else).

Note: privileged roles are required to enroll in TOTP MFA on first login (any authenticator app; the QR/secret is shown during setup).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run web + api + worker in watch mode |
| `pnpm build` | Build all packages and apps |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm test` | Unit tests (leave calc, org cycles, permission matrix) |
| `pnpm test:e2e` | API e2e: tenant isolation + onboarding (needs Postgres/Redis up) |
| `pnpm db:migrate` | Create & apply a dev migration |
| `pnpm db:deploy` | Apply committed migrations |
| `pnpm db:seed` | Idempotent demo seed |

## Repository layout

```
apps/web        Next.js frontend
apps/api        NestJS REST API
apps/worker     BullMQ job consumers
packages/types      Zod schemas + RBAC permission matrix
packages/database   Prisma schema, migrations, tenant client, seed
packages/config     Shared tsconfig
infrastructure/docker   Dockerfiles for api/worker/web
docs/           Architecture, assessment, migration strategy, checklist
hr-platform/    Legacy Flask prototype (read-only reference)
```

## Security model (summary)

- Tenant isolation enforced in four layers: per-request membership verification, CLS-scoped context, tenant-scoped Prisma client, and Postgres RLS — covered by automated e2e tests.
- Argon2id passwords, hashed opaque session tokens, email verification, Redis rate limiting, SameSite=Lax + Origin-check CSRF defense.
- TOTP MFA mandatory for privileged roles; recovery codes hashed at rest.
- Server-side RBAC permission matrix; salary/BVN/bank fields restricted to self + `compensation.read`.
- Append-only audit log, including all platform-admin activity.

**Do not deploy as-is** — complete the production-readiness gate in `docs/development-checklist.md` first.
