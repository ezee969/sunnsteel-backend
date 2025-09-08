-- AlterEnum
ALTER TYPE "ProgressionScheme" ADD VALUE 'PROGRAMMED_RTF';

-- AlterTable
ALTER TABLE "Routine" ADD COLUMN     "programDurationWeeks" INTEGER,
ADD COLUMN     "programEndDate" DATE,
ADD COLUMN     "programStartDate" DATE,
ADD COLUMN     "programStartWeek" INTEGER DEFAULT 1,
ADD COLUMN     "programTimezone" TEXT,
ADD COLUMN     "programTrainingDaysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "programWithDeloads" BOOLEAN;

-- AlterTable
ALTER TABLE "RoutineExercise" ADD COLUMN     "programLastAdjustedWeek" INTEGER,
ADD COLUMN     "programRoundingKg" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "programTMKg" DOUBLE PRECISION;
