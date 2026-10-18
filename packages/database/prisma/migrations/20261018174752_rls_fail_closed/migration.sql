-- ─────────────────────────────────────────────────────────────────────────────
-- Fail-closed row-level security.
--
-- Previous policies ("rls_enforcement_and_employee_seq") were deliberately
-- permissive when the tenant GUC was unset:
--     USING (NULLIF(current_setting('app.company_id', true), '') IS NULL
--            OR "companyId" = current_setting('app.company_id', true))
-- so any query the application issued outside the tenant wrapper — as the
-- non-owner role `khr_app` — saw every tenant's rows. This migration makes
-- the default DENY and grants each legitimate cross-tenant path its own
-- narrow, explicit policy:
--
--   tenant_isolation   ALL      "companyId" = app.company_id        (per table)
--   auth_member_read   SELECT   Membership only; app.scope = 'auth'
--                               AND "userId" = app.user_id
--   audit_insert       INSERT   AuditLog only;   app.scope = 'audit'
--   platform_read      SELECT   all tenant tables; app.scope = 'platform'
--
-- GUCs are transaction-local (`set_config(..., TRUE)`) and set exclusively by
-- the scoped clients in @peopleflow/database (tenantClient / authClient /
-- auditClient / platformClient). With no GUC set, `khr_app` sees nothing and
-- can write nothing on any RLS table.
--
-- RLS remains un-FORCEd: the table owner (`peopleflow`) bypasses it. The
-- owner credential is used only for migrations and seeding
-- (MIGRATE_DATABASE_URL); the api and worker connect as `khr_app`
-- (no BYPASSRLS, not the owner), so policies always bind in production.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper functions: empty-string GUCs read as NULL so comparisons fail closed.
CREATE OR REPLACE FUNCTION app_company_id() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('app.company_id', true), '')
$fn$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$fn$;

CREATE OR REPLACE FUNCTION app_scope() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('app.scope', true), '')
$fn$;

-- Strict tenant policies + read-only platform policy on every tenant table.
-- With app.company_id unset, app_company_id() is NULL, the comparison is
-- NULL, and both USING and the derived WITH CHECK reject the row.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Membership', 'Location', 'Department', 'Employee', 'EmergencyContact',
    'Compensation', 'EmploymentEvent', 'Holiday', 'LeaveType', 'LeavePolicy',
    'LeaveBalance', 'LeaveRequest', 'LeaveApproval', 'AttendancePolicy',
    'AttendanceRecord', 'AttendanceCorrection', 'AuditLog', 'EmployeeAvatar',
    'CompanyLogo', 'PayrollSettings', 'PayrollRun', 'Payslip'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("companyId" = app_company_id())',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS platform_read ON %I', t);
    EXECUTE format(
      'CREATE POLICY platform_read ON %I FOR SELECT USING (app_scope() = ''platform'')',
      t
    );
  END LOOP;
END
$$;

-- Auth scope: pre-tenant flows (session guard, login, company switcher) may
-- read ONLY the authenticated user's own memberships. SELECT only — no writes.
DROP POLICY IF EXISTS auth_member_read ON "Membership";
CREATE POLICY auth_member_read ON "Membership" FOR SELECT USING (
  app_scope() = 'auth' AND "userId" = app_user_id()
);

-- Audit scope: system audit writes originate from flows without tenant
-- context (failed logins, registration, platform actions) and may carry a
-- NULL or not-yet-active companyId. INSERT only — audit reads stay tenant-
-- or platform-scoped, and rows remain immutable to the app role.
DROP POLICY IF EXISTS audit_insert ON "AuditLog";
CREATE POLICY audit_insert ON "AuditLog" FOR INSERT WITH CHECK (
  app_scope() = 'audit'
);
