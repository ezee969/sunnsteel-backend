CREATE INDEX "training_event_personal_record_exercise"
ON "TrainingEvent" ("userId", (("payload"->>'exerciseId')), "occurredAt" DESC, "id" DESC)
WHERE "type" = 'PERSONAL_RECORD';
