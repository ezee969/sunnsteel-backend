-- LIVE-20: warm-ups that follow the exercise's first working set.
ALTER TABLE "RoutineExercise" ADD COLUMN IF NOT EXISTS "warmUpsFollowLoad" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RoutineExerciseSet" ADD COLUMN IF NOT EXISTS "warmUpShare" DOUBLE PRECISION;
