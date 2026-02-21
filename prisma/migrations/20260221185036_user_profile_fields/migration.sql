-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "age" INTEGER,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "height" DOUBLE PRECISION,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "sex" "Sex",
ADD COLUMN     "weight" DOUBLE PRECISION;
