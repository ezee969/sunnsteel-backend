-- LIVE-24: a correction can move a finished workout's end time earlier, and
-- the trail keeps the end as it was and as it became. Both are null for a
-- correction that left the end alone. Safe to run twice.
ALTER TABLE "SessionCorrection" ADD COLUMN IF NOT EXISTS "endedAtBefore" TIMESTAMP(3);
ALTER TABLE "SessionCorrection" ADD COLUMN IF NOT EXISTS "endedAtAfter" TIMESTAMP(3);
