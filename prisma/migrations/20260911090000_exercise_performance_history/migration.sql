CREATE INDEX "set_log_exercise_session_completed"
ON "SetLog" ("exerciseId", "sessionId")
WHERE "isCompleted" AND "reps" > 0;

CREATE INDEX "training_event_progression_session"
ON "TrainingEvent" ("userId", "sessionId")
WHERE "type" = 'PROGRESSION_CHANGED';
