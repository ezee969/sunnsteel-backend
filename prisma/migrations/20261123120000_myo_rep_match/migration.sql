-- LIVE-26: myo-rep match. A MATCH set lifts its target set's load and adds
-- mini-sets until its reps match; `reps` stays the first effort and the
-- mini-sets are kept in order in "matchReps". No backfill: no set has any yet.
ALTER TYPE "SetKind" ADD VALUE IF NOT EXISTS 'MATCH';
ALTER TABLE "SetLog" ADD COLUMN IF NOT EXISTS "matchReps" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
