-- CreateEnum
CREATE TYPE "ShirtSize" AS ENUM ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('PRIMARY_SCHOOL', 'JUNIOR_SECONDARY', 'SENIOR_SECONDARY', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'DOCTORATE');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "educationLevel" "EducationLevel",
ADD COLUMN     "shirtSize" "ShirtSize",
ADD COLUMN     "shoeSize" TEXT;
