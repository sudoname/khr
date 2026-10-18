-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "termsOfEmployment" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bvn" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "onboardingNote" TEXT,
ADD COLUMN     "onboardingReviewedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingReviewedById" TEXT,
ADD COLUMN     "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN     "onboardingSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- Backfill: employees that existed before self-service onboarding are treated
-- as already onboarded so they are not locked behind the new flow.
UPDATE "Employee"
SET "onboardingStatus" = 'APPROVED',
    "termsAcceptedAt" = CURRENT_TIMESTAMP;
