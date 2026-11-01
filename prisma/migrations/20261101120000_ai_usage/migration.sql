-- INTEL-03: one row per request to a model on a member's behalf. Idempotent,
-- so the analytics test database (scripts/prepare-analytics-test-db.ts) can
-- apply it as well.

DO $$ BEGIN
  CREATE TYPE "AiUsageStatus" AS ENUM ('PENDING', 'DELIVERED', 'NOT_TRAINING', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AiUsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "feature" VARCHAR(40) NOT NULL,
    "status" "AiUsageStatus" NOT NULL DEFAULT 'PENDING',
    "model" VARCHAR(60) NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiUsageRecord_userId_feature_createdAt_idx"
  ON "AiUsageRecord"("userId", "feature", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageRecord_createdAt_idx" ON "AiUsageRecord"("createdAt");

DO $$ BEGIN
  ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "AiUsageRecord_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
