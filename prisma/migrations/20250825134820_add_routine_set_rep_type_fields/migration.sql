-- CreateEnum
CREATE TYPE "RepType" AS ENUM ('FIXED', 'RANGE');

-- AlterTable
ALTER TABLE "RoutineExerciseSet" ADD COLUMN     "maxReps" INTEGER,
ADD COLUMN     "minReps" INTEGER,
ADD COLUMN     "repType" "RepType" NOT NULL DEFAULT 'FIXED',
ALTER COLUMN "reps" DROP NOT NULL;
