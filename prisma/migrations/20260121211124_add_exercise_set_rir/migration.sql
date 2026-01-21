-- AlterTable
ALTER TABLE "RoutineExercise" ADD COLUMN     "programStyle" "ProgramStyle";

-- AlterTable
ALTER TABLE "RoutineExerciseSet" ADD COLUMN     "rir" INTEGER;

-- AlterTable
ALTER TABLE "WorkoutSession" ALTER COLUMN "lastActivityAt" SET DATA TYPE TIMESTAMP(3);
