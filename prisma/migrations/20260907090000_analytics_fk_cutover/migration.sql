-- Production gates verified 2026-09-07; retain guards for every environment.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "WorkoutSession", "SetLog" IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "WorkoutSession" s LEFT JOIN "WorkoutSessionSnapshot" sn ON sn."sessionId" = s."id"
    WHERE sn."sessionId" IS NULL OR s."sourceRoutineId" IS NULL OR s."sourceRoutineDayId" IS NULL)
    OR EXISTS (SELECT 1 FROM "SetLog" WHERE "sourceRoutineExerciseId" IS NULL)
    OR EXISTS (SELECT 1 FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "WorkoutAnalyticsProjection" p WHERE p."userId" = u."id" AND p."active" AND p."state" = 'READY'))
    OR EXISTS (SELECT 1 FROM "WorkoutAnalyticsProjection" WHERE "state" = 'BUILDING')
  THEN RAISE EXCEPTION 'Analytics cutover blocked: snapshots, source IDs or ready projections missing'; END IF;
END $$;
-- DropForeignKey
ALTER TABLE "WorkoutSession" DROP CONSTRAINT "WorkoutSession_routineId_fkey";

-- DropForeignKey
ALTER TABLE "WorkoutSession" DROP CONSTRAINT "WorkoutSession_routineDayId_fkey";

-- DropForeignKey
ALTER TABLE "SetLog" DROP CONSTRAINT "SetLog_routineExerciseId_fkey";

-- AlterTable
ALTER TABLE "WorkoutSession" ALTER COLUMN "routineId" DROP NOT NULL,
ALTER COLUMN "routineDayId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SetLog" ALTER COLUMN "routineExerciseId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_routineDayId_fkey" FOREIGN KEY ("routineDayId") REFERENCES "RoutineDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetLog" ADD CONSTRAINT "SetLog_routineExerciseId_fkey" FOREIGN KEY ("routineExerciseId") REFERENCES "RoutineExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
