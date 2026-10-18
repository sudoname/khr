# Feature Matrix — PeopleFlow HR (KHR)

Date: 2026-10-18 @ `7aba71d` (branch `remediation/audit-2026-10`)

Legend: ✅ implemented · 🟡 partial · ❌ not built (tracked in `IMPLEMENTATION_STATUS.md`)

| Area | Status | Highlights | API / UI |
| --- | --- | --- | --- |
| **Authentication** | ✅ | Register (company + admin), login, email verification, password reset, Google OAuth, TOTP MFA with QR + recovery codes (enforced for privileged roles), session list/revoke, Redis rate limiting, enumeration resistance | `auth.controller.ts` (16 routes) · `/login` `/register` `/verify-email` `/forgot-password` `/reset-password` `/accept-invite` `/account` |
| **Companies & workspaces** | ✅ | Settings (name, timezone, currency, sector, RC number, employment terms), logo upload, member invites (72 h tokens), role management, last-admin protection, public slug lookup for branded login (rate-limited) | `companies.controller.ts` (9) + `workspaces.controller.ts` (4) · `/settings/company` `/settings/members` |
| **Employees** | ✅ | CRUD with auto employee numbers, status lifecycle (active/on-leave/suspended/terminated), terminate + rehire, photo upload, versioned compensation history, CSV import/export, event history, rent declaration (NTA 2025), field-level salary/BVN/bank restriction | `employees.controller.ts` (17) · `/people` `/people/[id]` `/profile` |
| **Org structure** | ✅ | Department tree (cycle-safe), locations, org chart, manager reassignment with cycle detection, department heads | `departments` (4) + `locations` (4) + `org` (2) · `/org` `/settings/structure` |
| **Employee self-onboarding** | ✅ | Invite → wizard (contact, address, NUBAN bank details, optional BVN, emergency contact) → HR review (approve/reject + note) → terms acceptance gate; Nigerian states + bank lists | `onboarding.controller.ts` (5) · `/onboarding` `/people/onboarding` |
| **Leave management** | ✅ | Types (paid/unpaid, half-days), policies (accrual method, entitlement, carryover, 1–2 approval levels), company holidays, year balances with manual audited adjustments, requests with working-day math (weekends + holidays excluded), overlap/balance validation, approval SoD, cancellation refunds, team calendar | `leave.controller.ts` (18) · `/leave` |
| **Attendance** | ✅ | Company policy (hours, grace, work days), timezone-aware clock-in/out with duplicate prevention and late detection, paginated records with permission scoping, correction requests with reviewer SoD and record materialization | `attendance.controller.ts` (10) · `/attendance` |
| **Payroll (Nigeria)** | ✅ | Versioned dual-regime tax engine (PITA FA2020 / NTA 2025), Decimal-exact money path, pension/NHF/NHIS/NSITF/ITF, run state machine with maker–checker SoD, reconciliation gate, tax-rules attestation, bank schedule CSV, payslip portal + emails | `payroll.controller.ts` (14) · `/payroll` `/payroll/[id]` — see `PAYROLL_COMPLIANCE.md` |
| **Dashboard & stats** | ✅ | Role-aware `/stats/overview`: headcount by status/department, attendance today (clocked-in/late), pending leave + corrections; charts and stat tiles on the dashboard | `stats.controller.ts` (1) · `/dashboard` |
| **Audit log** | ✅ | Tenant-scoped structured trail across auth, org, employees, onboarding, leave, attendance, payroll, platform access; INSERT-only RLS scope; filterable paginated viewer | `audit.controller.ts` (1) · `/settings/audit` |
| **Emails & jobs** | ✅ | BullMQ worker, 7 transactional emails (verify, reset, 2× invite, onboarding approved/rejected, payslip ready), branded HTML + plain-text fallback, best-effort queueing | `apps/worker` |
| **Platform admin** | 🟡 | Cross-tenant company listing API with platform RLS scope + audit; **no dedicated UI yet** | `GET /platform/companies` |
| **Per-company subdomains** | 🟡 | API groundwork shipped (workspace lookup, origin allowance, slug plumbing); login/web/deploy wiring parked pending remediation sign-off | plan: `A4–A6` |
| **Recruitment / ATS** | ❌ | No job requisitions, postings, candidates, interviews or offers | — |
| **Performance management** | ❌ | No goals/OKRs, review cycles or scorecards | — |
| **Training / L&D** | ❌ | No course catalog or enrollment tracking | — |
| **Document vault** | ❌ | Only logo/avatar uploads; no general document storage, versioning or per-document ACLs | — |
| **Report builder** | ❌ | Fixed CSV exports only (employees, bank schedule); no custom/scheduled reports | — |
| **Billing & subscriptions** | ❌ | No plans, payments, usage metering or invoicing | — |

## Test coverage by area

| Suite | Tests | Covers |
| --- | --- | --- |
| `tenant-isolation.e2e-spec.ts` | 20 | Cross-tenant invisibility across modules, onboarding flow |
| `rls-fail-closed.e2e-spec.ts` | 14 | Database-level policy matrix as the non-owner runtime role |
| `payroll-workflow.e2e-spec.ts` | 17 | Run lifecycle, SoD, attestation, reconciliation, exports, audit |
| `leave-attendance.e2e-spec.ts` | 28 | Leave/attendance workflows, balance math, SoD, audit |
| Unit (`apps/api`, `packages/types`) | 68 | Tax engine, leave-day math, CSV, image sniffing, org cycles, schema validation |
