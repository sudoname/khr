-- AlterEnum
ALTER TYPE "EmploymentType" ADD VALUE 'MIGRANT';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "livesOnsite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EmploymentContract" ADD COLUMN     "signatureAccuracy" DECIMAL(8,2),
ADD COLUMN     "signatureHash" TEXT,
ADD COLUMN     "signatureImage" TEXT,
ADD COLUMN     "signatureIp" TEXT,
ADD COLUMN     "signatureLat" DECIMAL(9,6),
ADD COLUMN     "signatureLng" DECIMAL(9,6),
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedName" TEXT;
