-- AlterTable
ALTER TABLE "PayrollSettings" ADD COLUMN     "payeEnabled" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "pensionEnabled" SET DEFAULT false;
