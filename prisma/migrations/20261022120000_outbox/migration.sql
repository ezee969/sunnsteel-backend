-- PLAT-01: the transactional outbox. Idempotent, so the analytics test
-- database (scripts/prepare-analytics-test-db.ts) can apply it as well.
-- pg-boss keeps its own tables in the `pgboss` schema and installs them
-- itself when the service starts.

CREATE TABLE IF NOT EXISTS "OutboxMessage" (
    "id" TEXT NOT NULL,
    "topic" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(500),
    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutboxMessage_dedupeKey_key" ON "OutboxMessage"("dedupeKey");

-- The dispatcher reads only what is waiting, oldest first.
CREATE INDEX IF NOT EXISTS "OutboxMessage_waiting_idx"
  ON "OutboxMessage"("createdAt") WHERE "dispatchedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "ProcessedMessage" (
    "consumer" VARCHAR(100) NOT NULL,
    "messageId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessedMessage_pkey" PRIMARY KEY ("consumer", "messageId")
);
