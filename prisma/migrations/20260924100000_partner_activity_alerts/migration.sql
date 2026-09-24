-- NOTIF-07: partner activity is explicitly opt-in. The enable timestamps are
-- replay boundaries: activity from before the choice never becomes a new alert.
ALTER TABLE "User"
  ADD COLUMN "notifyPartnerSession" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notifyPartnerAchievement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "partnerSessionAlertsEnabledAt" TIMESTAMP(3),
  ADD COLUMN "partnerAchievementAlertsEnabledAt" TIMESTAMP(3);

ALTER TYPE "NotificationKind" ADD VALUE 'TRAINING_PARTNER_SESSION';
ALTER TYPE "NotificationKind" ADD VALUE 'TRAINING_PARTNER_ACHIEVEMENT';

ALTER TABLE "Notification"
  ADD COLUMN "pushProcessedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE INDEX "Notification_kind_pushProcessedAt_createdAt_idx"
  ON "Notification"("kind", "pushProcessedAt", "createdAt");
