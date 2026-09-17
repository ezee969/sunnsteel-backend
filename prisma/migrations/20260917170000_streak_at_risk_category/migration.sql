-- NOTIF-06: a third notification category, switchable like the other two.
-- It rides the NOTIF-04 reminder time rather than owning a delivery path.
ALTER TABLE "User"
  ADD COLUMN "notifyStreakAtRisk" BOOLEAN NOT NULL DEFAULT true;
