-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "totalBonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalOtherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "adjustmentNote" TEXT,
ADD COLUMN     "bonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "otherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0;
