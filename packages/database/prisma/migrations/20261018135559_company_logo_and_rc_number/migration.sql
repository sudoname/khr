-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "rcNumber" TEXT;

-- CreateTable
CREATE TABLE "CompanyLogo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyLogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLogo_companyId_key" ON "CompanyLogo"("companyId");

-- AddForeignKey
ALTER TABLE "CompanyLogo" ADD CONSTRAINT "CompanyLogo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same policy form as the other tenant tables (see the
-- rls_enforcement_and_employee_seq migration): scoped when app.company_id is
-- set, permissive when unset (trusted raw-client paths). khr_app already has
-- CRUD on new tables via ALTER DEFAULT PRIVILEGES.
ALTER TABLE "CompanyLogo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompanyLogo" USING (
  NULLIF(current_setting('app.company_id', true), '') IS NULL
  OR "companyId" = current_setting('app.company_id', true)
);
