ALTER TYPE "TrainingEventType" ADD VALUE 'STREAK_MILESTONE';
ALTER TYPE "TrainingEventType" ADD VALUE 'ACHIEVEMENT_UNLOCKED';

ALTER TABLE "TrainingEvent"
ALTER COLUMN "sessionId" DROP NOT NULL;

CREATE INDEX "training_event_user_type_occurred"
ON "TrainingEvent" ("userId", "type", "occurredAt" DESC, "id" DESC);
