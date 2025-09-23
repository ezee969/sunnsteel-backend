-- CreateEnum
CREATE TYPE "ProgramStyle" AS ENUM ('STANDARD', 'HYPERTROPHY');

-- AlterTable
ALTER TABLE "Routine" ADD COLUMN     "programStyle" "ProgramStyle";
