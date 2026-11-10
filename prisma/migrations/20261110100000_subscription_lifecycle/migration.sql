-- BILL-04: subscription lifecycle and reconciliation. Idempotent, so the
-- analytics test database (scripts/prepare-analytics-test-db.ts) can apply it
-- as well.

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PAYMENT_FAILED';

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "pastDueSince" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);

-- The free trial an attempt opened, so its confirmation knows to start TRIALING.
ALTER TABLE "CheckoutAttempt" ADD COLUMN IF NOT EXISTS "trialDays" INTEGER;

-- The daily reconciliation walks only subscriptions that can still change.
CREATE INDEX IF NOT EXISTS "Subscription_status_lastSyncedAt_idx" ON "Subscription"("status", "lastSyncedAt");

-- What the provider told us, stored before it is acted on. One row per
-- provider event, so a notification delivered twice is handled once.
CREATE TABLE IF NOT EXISTS "ProviderNotification" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "externalEventId" VARCHAR(200) NOT NULL,
    "topic" VARCHAR(100) NOT NULL,
    "resourceId" VARCHAR(200),
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "outcome" VARCHAR(100),
    CONSTRAINT "ProviderNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderNotification_provider_externalEventId_key"
  ON "ProviderNotification"("provider", "externalEventId");
