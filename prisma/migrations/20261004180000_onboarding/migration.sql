-- ONBOARD-01: how far an account has come through onboarding. Every account
-- that exists when this runs is marked as having completed version 1, so it
-- is offered only steps added later; the default then becomes 0, so a new
-- account starts the flow. Idempotent: a re-run finds the column and only
-- sets the default again.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingCompletedVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ALTER COLUMN "onboardingCompletedVersion" SET DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingStepsDone" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingOfferedAt" TIMESTAMP(3);
