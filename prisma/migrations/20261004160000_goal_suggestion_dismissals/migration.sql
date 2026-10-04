-- ACH-06: goal suggestions a member set aside with "Not now". A suggestion
-- stays hidden while it would suggest the same number for the same key.
-- Idempotent, because production runs migrate deploy on every deploy.
CREATE TABLE IF NOT EXISTS "GoalSuggestionDismissal" (
    "userId" TEXT NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalSuggestionDismissal_pkey" PRIMARY KEY ("userId","key")
);

CREATE INDEX IF NOT EXISTS "GoalSuggestionDismissal_userId_dismissedAt_idx" ON "GoalSuggestionDismissal"("userId", "dismissedAt");

DO $$ BEGIN
  ALTER TABLE "GoalSuggestionDismissal" ADD CONSTRAINT "GoalSuggestionDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
