-- SOC-06: comments on a generated activity entry.
--
-- Keyed by the same stable `entryKey` a SOC-05 reaction uses. SOC-03 entries
-- are generated on read and never stored, so that key is the only identity an
-- activity has; `authorId` is the entry's owner, resolved when the comment is
-- accepted so the list read and the notification both know whose activity it
-- hangs from without re-deriving the entry.
--
-- `moderationHiddenAt` is TRUST-04's hide, the same column and the same
-- meaning it has on Routine, SessionShare and User: gone for everyone but the
-- person who wrote it, with the row and its text untouched.

-- A comment is the first reportable thing a member wrote rather than did.
ALTER TYPE "ReportSubjectKind" ADD VALUE 'COMMENT';

-- The first notification another member causes on purpose.
ALTER TYPE "NotificationKind" ADD VALUE 'ACTIVITY_COMMENT';

CREATE TABLE "ActivityComment" (
    "id" TEXT NOT NULL,
    "entryKey" VARCHAR(200) NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "moderationHiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityComment_pkey" PRIMARY KEY ("id")
);

-- The list read: one entry's comments, oldest first, paged by (createdAt, id).
-- The id breaks ties because two comments can share a millisecond and the
-- cursor has to be total, the same reason SOC-03's cursor carries digests.
CREATE INDEX "ActivityComment_entryKey_createdAt_id_idx" ON "ActivityComment"("entryKey", "createdAt", "id");

-- Everything addressed to one member, for the notification gatherer.
CREATE INDEX "ActivityComment_authorId_createdAt_idx" ON "ActivityComment"("authorId", "createdAt");

-- Everything one member wrote, for the per-day rate limit.
CREATE INDEX "ActivityComment_userId_createdAt_idx" ON "ActivityComment"("userId", "createdAt");

ALTER TABLE "ActivityComment" ADD CONSTRAINT "ActivityComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityComment" ADD CONSTRAINT "ActivityComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
