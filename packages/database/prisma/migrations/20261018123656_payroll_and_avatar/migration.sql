-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "EmployeeAvatar" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAvatar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "basicPercent" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "housingPercent" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "transportPercent" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "pensionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pensionEmployeePercent" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "pensionEmployerPercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "nhfEnabled" BOOLEAN NOT NULL DEFAULT false,
    "nhfPercent" DECIMAL(5,2) NOT NULL DEFAULT 2.5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "totalGross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalPaye" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalPensionEmployee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalPensionEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalNhf" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "grossMonthly" DECIMAL(18,2) NOT NULL,
    "basic" DECIMAL(18,2) NOT NULL,
    "housing" DECIMAL(18,2) NOT NULL,
    "transport" DECIMAL(18,2) NOT NULL,
    "otherAllowances" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pensionEmployee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pensionEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "nhf" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cra" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableIncome" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paye" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeAvatar_employeeId_key" ON "EmployeeAvatar"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeAvatar_companyId_idx" ON "EmployeeAvatar"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSettings_companyId_key" ON "PayrollSettings"("companyId");

-- CreateIndex
CREATE INDEX "PayrollRun_companyId_status_idx" ON "PayrollRun"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_companyId_year_month_key" ON "PayrollRun"("companyId", "year", "month");

-- CreateIndex
CREATE INDEX "Payslip_companyId_idx" ON "Payslip"("companyId");

-- CreateIndex
CREATE INDEX "Payslip_employeeId_idx" ON "Payslip"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_runId_employeeId_key" ON "Payslip"("runId", "employeeId");

-- AddForeignKey
ALTER TABLE "EmployeeAvatar" ADD CONSTRAINT "EmployeeAvatar_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row level security: tenant isolation for new tables
ALTER TABLE "EmployeeAvatar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmployeeAvatar" USING ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "PayrollSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollSettings" USING ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "PayrollRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayrollRun" USING ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "Payslip" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payslip" USING ("companyId" = current_setting('app.company_id', true));
