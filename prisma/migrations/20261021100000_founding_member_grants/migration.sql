-- BILL-02: every account that exists when Pro gating ships receives a
-- non-expiring founding-member PROMO grant, so nobody loses a capability they
-- already used. Accounts created afterwards start on Free.
--
-- Safe to run twice: an account that ever held a founding-member grant --
-- even one since revoked -- is never granted again, and an account with an
-- open PROMO grant keeps it (one open grant per member and source).
INSERT INTO "EntitlementGrant" ("id", "userId", "planId", "source", "startsAt", "expiresAt", "note", "createdAt")
SELECT gen_random_uuid()::text, u."id", 'PRO', 'PROMO', NOW() AT TIME ZONE 'UTC', NULL, 'Founding member', NOW() AT TIME ZONE 'UTC'
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "EntitlementGrant" g
  WHERE g."userId" = u."id"
    AND g."source" = 'PROMO'
    AND (g."revokedAt" IS NULL OR g."note" = 'Founding member')
);
