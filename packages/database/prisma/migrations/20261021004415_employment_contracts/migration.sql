-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Contract of Employment',
    "clauses" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentContract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "clauses" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractTemplate_companyId_key" ON "ContractTemplate"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentContract_employeeId_key" ON "EmploymentContract"("employeeId");

-- CreateIndex
CREATE INDEX "EmploymentContract_companyId_idx" ON "EmploymentContract"("companyId");

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentContract" ADD CONSTRAINT "EmploymentContract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fail-closed RLS for the new tenant tables (same matrix as `rls_fail_closed`):
--   tenant_isolation  ALL     "companyId" = app_company_id()
--   platform_read     SELECT  app_scope() = 'platform'
-- khr_app CRUD grants arrive automatically via the ALTER DEFAULT PRIVILEGES
-- set up in `rls_enforcement_and_employee_seq`.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ContractTemplate', 'EmploymentContract']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
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
