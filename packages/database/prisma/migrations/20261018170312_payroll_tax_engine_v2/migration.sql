-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "annualRentDeclared" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "engineVersion" TEXT,
ADD COLUMN     "taxRegime" TEXT,
ADD COLUMN     "totalItf" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalNhis" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalNsitf" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalRentRelief" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayrollSettings" ADD COLUMN     "itfEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "itfPercent" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "nhisEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nhisPercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
ADD COLUMN     "nsitfEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nsitfPercent" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "taxRulesApprovedAt" TIMESTAMP(3),
ADD COLUMN     "taxRulesApprovedById" TEXT,
ADD COLUMN     "taxRulesApprovedVersion" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "itf" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nhis" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nsitf" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rentRelief" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRegime" TEXT;
