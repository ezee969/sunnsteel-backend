-- LIVE-12: what a set is for. Every existing set and set log is a working set.
DO $$ BEGIN
  CREATE TYPE "SetKind" AS ENUM ('WORKING', 'WARMUP', 'DROP', 'OPTIONAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "RoutineExerciseSet" ADD COLUMN IF NOT EXISTS "kind" "SetKind" NOT NULL DEFAULT 'WORKING';
ALTER TABLE "SetLog" ADD COLUMN IF NOT EXISTS "kind" "SetKind" NOT NULL DEFAULT 'WORKING';
