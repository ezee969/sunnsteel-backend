-- LIVE-11: exercises performed in place of routine slots for one session.
-- The session snapshot stays the immutable prescription; this records what
-- was done instead, as SessionExerciseSubstitution[] from @sunsteel/contracts.
ALTER TABLE "WorkoutSession" ADD COLUMN "exerciseSubstitutions" JSONB NOT NULL DEFAULT '[]';
