-- ROUT-17 to ROUT-19: the 8-week linear periodization block.
ALTER TYPE "ProgressionScheme" ADD VALUE IF NOT EXISTS 'LINEAR_PERIODIZATION';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'LINEAR_BLOCK_FINISHED';
ALTER TABLE "RoutineExercise" ADD COLUMN IF NOT EXISTS "linearPeriodization" JSONB;
ALTER TABLE "WorkoutSession" ADD COLUMN IF NOT EXISTS "linearBlockChanges" JSONB NOT NULL DEFAULT '[]';
