# Security Review — PeopleFlow HR (KHR)

Date: 2026-10-18
Branch: `remediation/audit-2026-10` @ `7aba71d`

## 1. Authentication & sessions

| Control | Implementation |
| --- | --- |
| Password hashing | Argon2id (`argon2` library defaults) |
| Sessions | Random opaque token, DB-backed (`Session` table) with `expiresAt`; list + per-session revocation (`GET/DELETE /auth/sessions`) |
| Cookie | `HttpOnly`, `SameSite=Lax`, `Secure` in production; first-party because the web app proxies `/api/*` to the API (no cross-site cookie concessions) |
| Email verification | 24 h single-use token; login requires a verified email |
| Password reset | 1 h single-use token; response shape identical for known/unknown emails (enumeration-resistant) |
| MFA | TOTP (otplib) with recovery codes; **enforced for privileged roles**; QR enrollment; login returns an MFA challenge instead of a session until verified |
| OAuth | Google sign-in with server-generated `state` nonce in an HttpOnly cookie, strict equality check on callback |
| Rate limiting | Redis-backed: registration 10/h/IP, login 30/15 min/IP + 10/15 min/email, public workspace lookup 60/5 min/IP |
| Registration | Does not leak workspace slugs or whether an email exists |

## 2. Multi-tenancy (defense in depth)

Three independent layers must all fail for a cross-tenant access:

1. **AuthGuard + RBAC** — every request resolves a membership; tenant-scoped endpoints 403 without one; permissions checked against the server-side role matrix (7 company roles + platform admin) in `packages/types/src/roles.ts`.
2. **Scoped Prisma clients** — services only receive `prisma.tenant(companyId)`, which injects `companyId` into every where/data clause for the 22 tenant models and wraps each operation in a transaction that sets the tenant GUC.
3. **Postgres RLS, fail-closed** — the runtime DB role (`khr_app`) is a non-owner; every tenant table carries `tenant_isolation` (`"companyId" = app_company_id()`, USING + WITH CHECK). The GUC helpers coerce empty/unset values to NULL, so **a missing context yields zero rows and zero writable rows** — not "all rows" as before remediation. Narrow side-channels are explicit: `platform_read` (SELECT-only platform scope), `auth_member_read` (own memberships, pre-tenant login flow), `audit_insert` (INSERT-only audit writer).

Interactive transactions that cannot use the extended client set the GUC transaction-locally via `set_config(..., true)` and keep explicit `companyId` predicates.

**Proof, not assertion:** the whole e2e suite (79 tests) runs under `khr_app` credentials; `rls-fail-closed.e2e-spec.ts` additionally proves default-deny, `companyId`-smuggling overwrite, re-homing rejection (WITH CHECK), scope confinement of the auth/audit/platform clients, and cross-tenant invisibility.

## 3. Authorization & workflow controls

- Permission strings (e.g. `payroll.approve`, `leave.policy.manage`, `attendance.correct.review`) enforced via a global guard + decorator; e2e tests assert 403s for under-privileged roles.
- Payroll maker–checker: approver ≠ creator and ≠ submitter at the user level, regardless of role (`PAYROLL_SOD_VIOLATION`).
- Payroll reconciliation: payslip aggregates must exactly equal the stamped run totals before approval (tamper detection, `RECONCILIATION_MISMATCH`).
- Tax attestation: runs cannot be finalized until a human approves the exact engine version (`TAX_RULES_NOT_APPROVED` / `TAX_ENGINE_STALE`).
- Leave: requesters cannot decide their own requests; deciders need `leave.approve` plus chain or `leave.read.all` visibility; balance mutations happen only on approval/cancellation.
- Attendance: reviewers cannot review their own corrections; correction approval is the only non-clock path that materializes records (`source: CORRECTION`).
- Last-admin protection on membership removal; field-level restriction keeps salary/BVN/bank data behind `compensation.read`.

## 4. Input handling & data protection

- All request bodies/queries validated by shared Zod schemas (`packages/types`); money accepted as strings and processed as `Prisma.Decimal` (no floats).
- File uploads (logo/avatar): 2 MB cap, content sniffing (`image-sniff`) rather than trusting declared MIME, served with bounded cache headers.
- NUBAN (10-digit) and BVN (11-digit) validation on onboarding; BVN optional.
- Audit log records action, entity, actor, IP and bounded metadata — **never** passwords, tokens, BVN or bank numbers.
- SQL access exclusively through Prisma / parameterized `Prisma.sql`; no string-built queries.
- CORS restricted to configured web origins (with an env-gated base-domain allowance for the planned per-company subdomains); `x-workspace-slug` is stripped from client requests by the web middleware and injected server-side only.

## 5. Auditability

Structured, tenant-scoped audit trail covering auth, company settings, membership, employee lifecycle, onboarding review, leave, attendance and every payroll transition (8 payroll actions, 11 leave actions, 5 attendance actions). Writes are best-effort (never block the business operation) through an INSERT-only RLS scope; a paginated viewer exists at `/settings/audit`. E2e suites assert presence of every workflow action.

## 6. Open items & recommendations (P2)

| Item | Recommendation |
| --- | --- |
| Managed infrastructure | Move Postgres/Redis to managed services with backups + PITR before scaling tenants |
| Observability | Add error tracking (e.g. Sentry) and metrics; currently structured logs only |
| Load & pen testing | Load-test auth/attendance hot paths; commission an external penetration test focused on tenant isolation (internal adversarial tests exist but are not a substitute) |
| File storage | Logo/avatar bytes live in Postgres; acceptable at current scale, move to object storage with signed URLs as volume grows |
| Session hardening | Consider rotating session tokens on privilege changes (MFA enable, role change) |
| Secrets | Ensure `SESSION_SECRET` ≥ 32 random bytes in production; rotate any credential that was ever shared over chat or email |
| Incident response | Write the runbook (contacts, revocation steps, tenant-notification procedure) before onboarding paying tenants |

No open P0/P1 security findings as of `7aba71d`.
