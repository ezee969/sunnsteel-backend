-- BILL-06: a one-off data fix. The sandbox test purchase made in production
-- on 2026-11-18 (Mercado Pago preapproval 6210e09e3862463c86998b4e9026a3c1)
-- was still in its free trial when real charges were switched on on
-- 2026-11-19, and the live credentials cannot read a sandbox preapproval, so
-- the nightly reconciliation would have failed on it every night and its
-- member could not cancel it. It was cancelled in Mercado Pago's sandbox the
-- same day; this records that cancellation the way the app records any
-- (`nextSubscriptionState`): a trial cancelled before it ends is CANCELED and
-- Pro ends with the trial, since nothing was paid.
--
-- Keyed on that one preapproval and only while it is still TRIALING, so it is
-- a no-op on every other database and on a second run.

WITH closed AS (
  UPDATE "Subscription"
  SET "status" = 'CANCELED',
      "cancelAtPeriodEnd" = true,
      "currentPeriodEnd" = "trialEndsAt",
      "updatedAt" = now()
  WHERE "provider" = 'MERCADO_PAGO'
    AND "externalId" = '6210e09e3862463c86998b4e9026a3c1'
    AND "status" = 'TRIALING'
  RETURNING "id", "trialEndsAt"
)
UPDATE "EntitlementGrant" AS g
SET "expiresAt" = CASE WHEN c."trialEndsAt" > now() THEN c."trialEndsAt" ELSE g."expiresAt" END,
    "revokedAt" = CASE WHEN c."trialEndsAt" > now() THEN NULL ELSE now() END
FROM closed AS c
WHERE g."subscriptionId" = c."id"
  AND g."source" = 'SUBSCRIPTION'
  AND g."revokedAt" IS NULL;
