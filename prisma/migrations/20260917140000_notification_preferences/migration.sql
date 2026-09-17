-- NOTIF-05: per-category delivery switches, a local quiet window and the
-- NOTIF-04 reminder time. All are evaluated in the account's stored time zone.
-- A null reminder minute means reminders are off; choosing a time opts in.
ALTER TABLE "User"
  ADD COLUMN "notifyRestAlert" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyTrainingReminder" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "quietHoursStartMinute" INTEGER,
  ADD COLUMN "quietHoursEndMinute" INTEGER,
  ADD COLUMN "reminderMinuteOfDay" INTEGER;

-- Minutes from local midnight. Bounded in the database as well as the DTO,
-- because an out-of-range value would silence an account with no way to see why.
ALTER TABLE "User"
  ADD CONSTRAINT "User_quietHoursStartMinute_range"
    CHECK ("quietHoursStartMinute" IS NULL
           OR ("quietHoursStartMinute" >= 0 AND "quietHoursStartMinute" < 1440)),
  ADD CONSTRAINT "User_quietHoursEndMinute_range"
    CHECK ("quietHoursEndMinute" IS NULL
           OR ("quietHoursEndMinute" >= 0 AND "quietHoursEndMinute" < 1440)),
  ADD CONSTRAINT "User_reminderMinuteOfDay_range"
    CHECK ("reminderMinuteOfDay" IS NULL
           OR ("reminderMinuteOfDay" >= 0 AND "reminderMinuteOfDay" < 1440)),
  -- A window needs both ends; one alone cannot be evaluated.
  ADD CONSTRAINT "User_quietHours_paired"
    CHECK (("quietHoursStartMinute" IS NULL) = ("quietHoursEndMinute" IS NULL));

-- NOTIF-04: a reminder is planned for a local date and belongs to no session,
-- so the pending-push identity moves from `sessionId` to an explicit key.
ALTER TABLE "ScheduledPush" ADD COLUMN "dedupeKey" TEXT;

UPDATE "ScheduledPush"
SET "dedupeKey" = 'rest:' || "sessionId"
WHERE "dedupeKey" IS NULL;

ALTER TABLE "ScheduledPush" ALTER COLUMN "dedupeKey" SET NOT NULL;
ALTER TABLE "ScheduledPush" ALTER COLUMN "sessionId" DROP NOT NULL;

DROP INDEX IF EXISTS "ScheduledPush_sessionId_key";
CREATE UNIQUE INDEX "ScheduledPush_dedupeKey_key" ON "ScheduledPush"("dedupeKey");
