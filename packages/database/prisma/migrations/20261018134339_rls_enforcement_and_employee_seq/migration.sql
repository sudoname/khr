-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "employeeNoSeq" INTEGER NOT NULL DEFAULT 0;

-- Initialize each company's employee-number counter to its current employee
-- count, so the next allocation continues the existing EMP-XXXX sequence.
UPDATE "Company" c
SET "employeeNoSeq" = (SELECT COUNT(*) FROM "Employee" e WHERE e."companyId" = c.id);

-- ───────────────────────── RLS enforcement ─────────────────────────
--
-- Until now the RLS policies were inert: the app connected as the table owner
-- (`peopleflow`, also the bootstrap superuser), which bypasses non-FORCEd RLS,
-- and `app.company_id` was never set.
--
-- This migration makes them real:
--   1. A non-owner application role `khr_app` is created (idempotently). It
--      has CRUD on all tables but does NOT own them, so `ENABLE ROW LEVEL
--      SECURITY` applies to it. Its password is set out-of-band:
--        ALTER ROLE khr_app PASSWORD '<APP_DB_PASSWORD>';
--      and the api/worker connect as khr_app (see docker-compose.prod.yml).
--      Migrations keep running as the owner, which bypasses RLS.
--   2. Policies are rewritten to be *permissive when app.company_id is unset*:
--      the raw Prisma client legitimately queries across tenants (auth looks
--      up a user's memberships in all companies) and never sets the GUC. The
--      tenant client sets it on every operation, so any bug in its
--      where-injection — e.g. a model missing from TENANT_MODELS — is still
--      contained by the database.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'khr_app') THEN
    CREATE ROLE khr_app LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO khr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO khr_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO khr_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO khr_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO khr_app;

-- Rewrite every tenant policy: scoped when app.company_id is set, permissive
-- when unset (trusted raw-client paths). NULLIF guards against '' from a
-- reset GUC.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Membership', 'Location', 'Department', 'Employee', 'EmergencyContact',
    'Compensation', 'EmploymentEvent', 'Holiday', 'LeaveType', 'LeavePolicy',
    'LeaveBalance', 'LeaveRequest', 'LeaveApproval', 'AttendancePolicy',
    'AttendanceRecord', 'AttendanceCorrection', 'AuditLog', 'EmployeeAvatar',
    'PayrollSettings', 'PayrollRun', 'Payslip'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ('
      || 'NULLIF(current_setting(''app.company_id'', true), '''') IS NULL '
      || 'OR "companyId" = current_setting(''app.company_id'', true))',
      t
    );
  END LOOP;
END
$$;
