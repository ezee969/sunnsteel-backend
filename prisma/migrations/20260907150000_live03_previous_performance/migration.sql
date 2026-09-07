CREATE INDEX "workout_previous_performance"
ON "WorkoutSession"("userId", "sourceRoutineDayId", "status", "endedAt" DESC, "id" DESC);
