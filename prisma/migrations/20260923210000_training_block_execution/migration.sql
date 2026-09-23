-- ROUT-15: a training block's setup is executed through its own working copy
-- of days, exercises and sets, kept beside the routine's baseline days and
-- marked by `trainingBlockId`. A session records the block it trained.
-- Idempotent: every step can be re-run.

ALTER TABLE "RoutineDay" ADD COLUMN IF NOT EXISTS "trainingBlockId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RoutineDay_trainingBlockId_fkey'
  ) THEN
    ALTER TABLE "RoutineDay"
    ADD CONSTRAINT "RoutineDay_trainingBlockId_fkey"
    FOREIGN KEY ("trainingBlockId") REFERENCES "RoutineTrainingBlock"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- A weekday appears once per routine among the baseline days, and once per
-- block among that block's days. The old routine-wide unique would refuse a
-- block that trains on the same weekday as its routine.
DROP INDEX IF EXISTS "RoutineDay_routineId_dayOfWeek_key";
CREATE UNIQUE INDEX IF NOT EXISTS "RoutineDay_baseline_dayOfWeek_key"
ON "RoutineDay"("routineId", "dayOfWeek") WHERE "trainingBlockId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "RoutineDay_block_dayOfWeek_key"
ON "RoutineDay"("trainingBlockId", "dayOfWeek") WHERE "trainingBlockId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "RoutineDay_routineId_trainingBlockId_idx"
ON "RoutineDay"("routineId", "trainingBlockId");
CREATE INDEX IF NOT EXISTS "RoutineDay_trainingBlockId_idx"
ON "RoutineDay"("trainingBlockId");

ALTER TABLE "WorkoutSession" ADD COLUMN IF NOT EXISTS "trainingBlockId" TEXT;
ALTER TABLE "WorkoutSession" ADD COLUMN IF NOT EXISTS "trainingBlockSeriesId" TEXT;
ALTER TABLE "WorkoutSession" ADD COLUMN IF NOT EXISTS "trainingBlockRevision" INTEGER;
ALTER TABLE "WorkoutSession" ADD COLUMN IF NOT EXISTS "trainingBlockName" VARCHAR(60);
CREATE INDEX IF NOT EXISTS "WorkoutSession_routineId_trainingBlockSeriesId_status_endedAt_idx"
ON "WorkoutSession"("routineId", "trainingBlockSeriesId", "status", "endedAt");

-- Every current block revision written before ROUT-15 gets its working copy
-- from its stored setup, exactly as the service now writes one. Revisions
-- that already have days are left alone, which is what makes this re-runnable.
WITH block_days AS (
  SELECT gen_random_uuid()::text AS id,
         b."id" AS block_id,
         b."routineId" AS routine_id,
         d.value AS day
  FROM "RoutineTrainingBlock" b
  CROSS JOIN LATERAL jsonb_array_elements(b."setup"->'days') AS d(value)
  WHERE b."supersededAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "RoutineDay" rd WHERE rd."trainingBlockId" = b."id"
    )
),
inserted_days AS (
  INSERT INTO "RoutineDay" ("id", "routineId", "trainingBlockId", "dayOfWeek", "name", "order")
  SELECT id, routine_id, block_id,
         (day->>'dayOfWeek')::int,
         day->>'name',
         COALESCE((day->>'order')::int, 0)
  FROM block_days
  RETURNING "id"
),
block_exercises AS (
  SELECT gen_random_uuid()::text AS id,
         bd.id AS day_id,
         e.value AS exercise
  FROM block_days bd
  CROSS JOIN LATERAL jsonb_array_elements(bd.day->'exercises') AS e(value)
),
inserted_exercises AS (
  INSERT INTO "RoutineExercise" ("id", "routineDayId", "exerciseId", "order", "restSeconds", "note", "progressionScheme", "minWeightIncrement")
  SELECT be.id, be.day_id,
         be.exercise->'exercise'->>'id',
         COALESCE((be.exercise->>'order')::int, 0),
         COALESCE((be.exercise->>'restSeconds')::int, 60),
         be.exercise->>'note',
         COALESCE(be.exercise->>'progressionScheme', 'NONE')::"ProgressionScheme",
         COALESCE((be.exercise->>'minWeightIncrement')::double precision, 2.5)
  FROM block_exercises be
  WHERE EXISTS (SELECT 1 FROM inserted_days d WHERE d."id" = be.day_id)
  RETURNING "id"
)
INSERT INTO "RoutineExerciseSet" ("id", "routineExerciseId", "setNumber", "repType", "reps", "minReps", "maxReps", "weight", "rir")
SELECT gen_random_uuid()::text, be.id,
       (s.value->>'setNumber')::int,
       COALESCE(s.value->>'repType', 'FIXED')::"RepType",
       (s.value->>'reps')::int,
       (s.value->>'minReps')::int,
       (s.value->>'maxReps')::int,
       (s.value->>'weight')::double precision,
       (s.value->>'rir')::int
FROM block_exercises be
CROSS JOIN LATERAL jsonb_array_elements(be.exercise->'sets') AS s(value)
WHERE EXISTS (SELECT 1 FROM inserted_exercises x WHERE x."id" = be.id);
