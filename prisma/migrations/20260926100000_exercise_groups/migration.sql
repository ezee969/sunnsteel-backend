-- ROUT-12: an exercise done in rounds with the next exercise of its day.
ALTER TABLE "RoutineExercise" ADD COLUMN IF NOT EXISTS "linkedToNext" BOOLEAN NOT NULL DEFAULT false;
