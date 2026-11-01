-- BILL-03: sandbox checkout. Idempotent, so the analytics test database
-- (scripts/prepare-analytics-test-db.ts) can apply it as well.

DO $$ BEGIN
  CREATE TYPE "CheckoutAttemptStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CheckoutAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" VARCHAR(20) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "status" "CheckoutAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" VARCHAR(200),
    "checkoutUrl" VARCHAR(2000),
    "failureCode" VARCHAR(100),
    "subscriptionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CheckoutAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CheckoutAttempt_userId_createdAt_idx" ON "CheckoutAttempt"("userId", "createdAt");

-- At most one waiting attempt per member, so a repeated press -- or two tabs
-- -- returns to it instead of opening a second. Prisma cannot declare a
-- partial index.
CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutAttempt_one_pending_per_user"
  ON "CheckoutAttempt"("userId") WHERE "status" = 'PENDING';

DO $$ BEGIN
  ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CheckoutAttempt" ADD CONSTRAINT "CheckoutAttempt_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
