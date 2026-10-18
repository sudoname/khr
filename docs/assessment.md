# Repository Assessment

Date: 2026-10-17 (Phase 1 kickoff)

## What existed before this build

The repository contained a single prototype under `hr-platform/`:

| Artifact | Notes |
| --- | --- |
| `hr-platform/app.py` | Single-file Flask MVP (~240 lines): auth, employees, leave, attendance, recruitment, draft NGN payroll |
| `hr-platform/requirements.txt` | Flask + stdlib sqlite3 |
| `hr-platform/static/style.css` | Minimal styling |
| `hr-platform/templates/` | Empty (HTML rendered inline) |
| `hr.sqlite3` | **Not present** — the database file was never committed, so there is no production or demo data to migrate |

## Strengths of the prototype

- Parameterized SQL throughout (no string-built queries).
- Per-session CSRF tokens on mutating forms.
- Company-scoped queries (an early notion of tenancy).
- Sensible core domain slices: employees, leave, attendance.

## Gaps that motivated a rebuild

| Area | Prototype | Requirement |
| --- | --- | --- |
| Tenancy | `company_id` filters hand-written per query | Enforced isolation (guard + scoped client + Postgres RLS) with automated isolation tests |
| Auth | Admin-only login, per-process secret key (sessions die on restart) | Employee logins, email verification, Argon2id, DB-backed sessions, TOTP MFA for privileged roles, rate limiting |
| RBAC | Single implicit admin | 7 company roles + platform admin, server-enforced permission matrix |
| Money | Python floats | `Decimal(18,2)` columns |
| Data | SQLite, no migrations | PostgreSQL + Prisma migrations, audit log |
| Ops | None | Docker Compose, CI, worker queue, structured logs |
| UI | Inline HTML strings | Next.js app with typed API client |

## Decision

**Greenfield TypeScript monorepo at the repo root** (confirmed with the project owner):

- No data exists, so there is nothing to migrate — a rewrite carries no data risk (see `migration-strategy.md` for the contingency plan had data existed).
- `hr-platform/` is retained, untouched, as a read-only functional reference for feature parity.
- Phase 1 scope: foundation (monorepo, Docker, CI), auth/RBAC/MFA, multi-tenancy with isolation tests, employees, departments/locations/org chart, leave, attendance, and employee self-onboarding. ATS, payroll (NG PAYE), performance, and L&D are deferred to later phases (see `development-checklist.md`).
