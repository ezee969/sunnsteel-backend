-- SOC-05: themed reactions on a generated activity entry.
--
-- One row per member per entry, so choosing another reaction replaces it and
-- there is nothing to accumulate. `authorId` is the entry's owner, resolved
-- when the reaction is accepted; an entry key belongs to one author by
-- construction, and storing it keeps the read one query per page.

CREATE TYPE "ActivityReaction" AS ENUM ('STRENGTH', 'DISCIPLINE', 'RESPECT', 'INSPIRING');

CREATE TABLE "ActivityEntryReaction" (
    "userId" TEXT NOT NULL,
    "entryKey" VARCHAR(200) NOT NULL,
    "authorId" TEXT NOT NULL,
    "reaction" "ActivityReaction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityEntryReaction_pkey" PRIMARY KEY ("userId","entryKey")
);

CREATE INDEX "ActivityEntryReaction_entryKey_idx" ON "ActivityEntryReaction"("entryKey");

CREATE INDEX "ActivityEntryReaction_authorId_entryKey_idx" ON "ActivityEntryReaction"("authorId", "entryKey");

ALTER TABLE "ActivityEntryReaction" ADD CONSTRAINT "ActivityEntryReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityEntryReaction" ADD CONSTRAINT "ActivityEntryReaction_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
