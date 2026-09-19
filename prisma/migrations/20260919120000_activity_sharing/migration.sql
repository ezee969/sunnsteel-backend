-- SOC-03/SOC-04: generated activity and its sharing controls.
--
-- Activity entries are generated on read from verified data and never stored.
-- The only new facts are the owner's choices -- a default audience per type
-- and an override per entry -- and when a routine was shared.

CREATE TYPE "ActivityType" AS ENUM ('SESSION_COMPLETED', 'PERSONAL_RECORD', 'PROGRESSION_CHANGED', 'ACHIEVEMENT_UNLOCKED', 'STREAK_MILESTONE', 'COMEBACK', 'ROUTINE_SHARED');

-- Left NULL on every existing routine: nothing recorded when a routine already
-- shared was shared, and backfilling updatedAt would invent a date. Such a
-- routine produces no activity entry until it is shared again.
ALTER TABLE "Routine" ADD COLUMN "sharedAt" TIMESTAMP(3);

-- A missing row means PRIVATE, so no default is backfilled either: nothing
-- reaches anyone until its owner chooses an audience for the type.
CREATE TABLE "ActivitySharingDefault" (
    "userId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "audience" "ProfileVisibility" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivitySharingDefault_pkey" PRIMARY KEY ("userId","type")
);

CREATE TABLE "ActivityEntryOverride" (
    "userId" TEXT NOT NULL,
    "entryKey" VARCHAR(200) NOT NULL,
    "type" "ActivityType" NOT NULL,
    "audience" "ProfileVisibility" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityEntryOverride_pkey" PRIMARY KEY ("userId","entryKey")
);

CREATE INDEX "ActivityEntryOverride_userId_type_idx" ON "ActivityEntryOverride"("userId", "type");

CREATE INDEX "Routine_userId_sharedAt_idx" ON "Routine"("userId", "sharedAt");

ALTER TABLE "ActivitySharingDefault" ADD CONSTRAINT "ActivitySharingDefault_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityEntryOverride" ADD CONSTRAINT "ActivityEntryOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
