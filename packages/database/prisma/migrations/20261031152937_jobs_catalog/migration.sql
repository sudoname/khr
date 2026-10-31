-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "jobId" TEXT;

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "responsibilities" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_companyId_idx" ON "Job"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_companyId_title_key" ON "Job"("companyId", "title");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security: Job is a tenant-child table (same fail-closed pattern
-- as every other tenant table).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Job']
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
