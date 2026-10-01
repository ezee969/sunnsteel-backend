-- ACH-10: who may see the member's rank, separate from achievements. It is
-- the one profile privacy setting that starts at PUBLIC, and by the owner's
-- decision of 2026-10-01 existing accounts start there too rather than
-- copying their achievements setting. Idempotent, like every migration here.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rankVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC';
