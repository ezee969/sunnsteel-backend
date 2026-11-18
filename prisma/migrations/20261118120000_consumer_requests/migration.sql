-- BILL-07: consumer-law requests -- a revocation (botón de arrepentimiento) or
-- a cancellation (botón de baja) anyone may ask for without an account.
-- Idempotent, so the analytics test database
-- (scripts/prepare-analytics-test-db.ts) can apply it as well.

DO $$ BEGIN
  CREATE TYPE "ConsumerRequestKind" AS ENUM ('REVOCATION', 'CANCELLATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ConsumerRequestStatus" AS ENUM ('OPEN', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Every moderator is told a request arrived; there is no email until TD-57.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'CONSUMER_REQUEST';

-- It names an email rather than a member, so deleting an account leaves the
-- request: it is the consumer's record that they asked, not the member's data.
CREATE TABLE IF NOT EXISTS "ConsumerRequest" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "kind" "ConsumerRequestKind" NOT NULL,
    "status" "ConsumerRequestStatus" NOT NULL DEFAULT 'OPEN',
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "reference" VARCHAR(100),
    "details" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),
    CONSTRAINT "ConsumerRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConsumerRequest_code_key" ON "ConsumerRequest"("code");
CREATE INDEX IF NOT EXISTS "ConsumerRequest_status_createdAt_idx" ON "ConsumerRequest"("status", "createdAt");
