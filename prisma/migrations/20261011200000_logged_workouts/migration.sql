-- LIVE-23: a workout logged after it happened. Every existing session was
-- trained in the app, so the column starts LIVE. Safe to run twice.
DO $$
BEGIN
  CREATE TYPE "WorkoutSessionOrigin" AS ENUM ('LIVE', 'LOGGED_LATER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "WorkoutSession"
  ADD COLUMN IF NOT EXISTS "origin" "WorkoutSessionOrigin" NOT NULL DEFAULT 'LIVE';

-- The routine's logged workouts are counted against a cap and listed on its
-- page; live sessions never pay for this index.
CREATE INDEX IF NOT EXISTS "WorkoutSession_routineId_logged_idx"
  ON "WorkoutSession" ("routineId", "startedAt")
  WHERE "origin" = 'LOGGED_LATER';
