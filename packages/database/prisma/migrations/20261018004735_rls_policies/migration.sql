-- Row Level Security policies for tenant-scoped tables.
--
-- Defense-in-depth: the application already scopes every query through the
-- tenant-aware Prisma client extension (packages/database/src/tenant.ts).
-- These policies add a database-level backstop keyed to the transaction-local
-- setting `app.company_id`.
--
-- Note: RLS is ENABLEd but not FORCEd. The application currently connects as
-- the table owner (`peopleflow`), which bypasses non-forced RLS. The policies
-- become active the moment a dedicated, non-owner application role is
-- introduced (recommended for production), without further schema changes.
-- A session/transaction must then run:
--   SET LOCAL app.company_id = '<company-uuid>';

-- Membership
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Membership"
  USING ("companyId" = current_setting('app.company_id', true));

-- Location
ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Location"
  USING ("companyId" = current_setting('app.company_id', true));

-- Department
ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department"
  USING ("companyId" = current_setting('app.company_id', true));

-- Employee
ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Employee"
  USING ("companyId" = current_setting('app.company_id', true));

-- EmergencyContact
ALTER TABLE "EmergencyContact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmergencyContact"
  USING ("companyId" = current_setting('app.company_id', true));

-- Compensation
ALTER TABLE "Compensation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Compensation"
  USING ("companyId" = current_setting('app.company_id', true));

-- EmploymentEvent
ALTER TABLE "EmploymentEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmploymentEvent"
  USING ("companyId" = current_setting('app.company_id', true));

-- Holiday
ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Holiday"
  USING ("companyId" = current_setting('app.company_id', true));

-- LeaveType
ALTER TABLE "LeaveType" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveType"
  USING ("companyId" = current_setting('app.company_id', true));

-- LeavePolicy
ALTER TABLE "LeavePolicy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeavePolicy"
  USING ("companyId" = current_setting('app.company_id', true));

-- LeaveBalance
ALTER TABLE "LeaveBalance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveBalance"
  USING ("companyId" = current_setting('app.company_id', true));

-- LeaveRequest
ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveRequest"
  USING ("companyId" = current_setting('app.company_id', true));

-- LeaveApproval
ALTER TABLE "LeaveApproval" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveApproval"
  USING ("companyId" = current_setting('app.company_id', true));

-- AttendancePolicy
ALTER TABLE "AttendancePolicy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AttendancePolicy"
  USING ("companyId" = current_setting('app.company_id', true));

-- AttendanceRecord
ALTER TABLE "AttendanceRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AttendanceRecord"
  USING ("companyId" = current_setting('app.company_id', true));

-- AttendanceCorrection
ALTER TABLE "AttendanceCorrection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AttendanceCorrection"
  USING ("companyId" = current_setting('app.company_id', true));

-- AuditLog: companyId is nullable (platform-level events have no company).
-- Tenant contexts may only see their own rows; platform rows (NULL) are
-- reserved for platform-admin access paths that run outside tenant context.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("companyId" = current_setting('app.company_id', true));
