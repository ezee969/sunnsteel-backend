-- Add lastActivityAt to WorkoutSession
ALTER TABLE "WorkoutSession" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP;
CREATE INDEX IF NOT EXISTS "WorkoutSession_lastActivityAt_idx" ON "WorkoutSession"("lastActivityAt");
