-- CreateEnum
CREATE TYPE "ProgressionScheme" AS ENUM ('DYNAMIC', 'DYNAMIC_DOUBLE');

-- AlterTable
ALTER TABLE "RoutineExercise" ADD COLUMN     "minWeightIncrement" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "progressionScheme" "ProgressionScheme" NOT NULL DEFAULT 'DYNAMIC';
