-- LIVE-16: the owner's note per exercise slot for one workout.
ALTER TABLE "WorkoutSession" ADD COLUMN "exerciseNotes" JSONB NOT NULL DEFAULT '[]';
