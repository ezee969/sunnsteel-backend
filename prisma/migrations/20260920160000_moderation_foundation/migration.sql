-- TRUST-04: the review side of PROF-10.
--
-- Three things arrive. A moderator flag, which is the whole authorization
-- model because there is one moderator. A review state on the reports that
-- have been accumulating since PROF-10 shipped, denormalised from the
-- enforcement records so the queue can page on it. And ModerationAction, an
-- append-only log of every power a moderator used: dismissing, hiding,
-- restoring and reading somebody's reported content.
--
-- The hide columns are deliberately on the subjects themselves rather than in
-- a join table. Every read that has to honour them already selects the row,
-- so the narrowing is a `where` clause instead of a lookup that a new read
-- could forget to make.

-- The whole authorization model.
ALTER TABLE "User" ADD COLUMN "isModerator" BOOLEAN NOT NULL DEFAULT false;

-- Set by HIDE_SUBJECT. The account keeps everything it owns and still reads
-- its own profile; it stops appearing to everyone else.
ALTER TABLE "User" ADD COLUMN "moderationHiddenAt" TIMESTAMP(3);
ALTER TABLE "Routine" ADD COLUMN "moderationHiddenAt" TIMESTAMP(3);
ALTER TABLE "SessionShare" ADD COLUMN "moderationHiddenAt" TIMESTAMP(3);

-- A hidden routine leaves discovery, profiles, activity and links; a hidden
-- share stops resolving. Both are read far more often than they are written,
-- and always alongside their owner or their token.
CREATE INDEX "Routine_userId_moderationHiddenAt_idx" ON "Routine"("userId", "moderationHiddenAt");
CREATE INDEX "User_moderationHiddenAt_idx" ON "User"("moderationHiddenAt");

CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACTIONED');

CREATE TYPE "ModerationActionKind" AS ENUM ('VIEW_SUBJECT', 'DISMISS_REPORT', 'HIDE_SUBJECT', 'RESTORE_SUBJECT');

-- Reports filed before this migration are exactly what the queue is for, so
-- they default to OPEN and appear in it rather than starting resolved.
ALTER TABLE "MemberReport" ADD COLUMN "status" "ReportStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "MemberReport" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "MemberReport" ADD COLUMN "resolvedById" TEXT;

ALTER TABLE "MemberReport" ADD CONSTRAINT "MemberReport_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "MemberReport_status_createdAt_id_idx" ON "MemberReport"("status", "createdAt", "id");

CREATE INDEX "MemberReport_subjectKind_subjectId_status_idx" ON "MemberReport"("subjectKind", "subjectId", "status");

-- Written once and never updated or deleted. Undoing a hide appends a
-- RESTORE_SUBJECT row rather than editing the HIDE_SUBJECT one, which is the
-- only way "the record is never editable" and "a mistaken hide is not
-- permanent" can both hold. `reportId` is not a foreign key on purpose: the
-- record has to outlive the report it was taken from.
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "kind" "ModerationActionKind" NOT NULL,
    "reportId" TEXT,
    "subjectKind" "ReportSubjectKind" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModerationAction_createdAt_id_idx" ON "ModerationAction"("createdAt", "id");

CREATE INDEX "ModerationAction_subjectKind_subjectId_createdAt_idx" ON "ModerationAction"("subjectKind", "subjectId", "createdAt");

CREATE INDEX "ModerationAction_reportId_idx" ON "ModerationAction"("reportId");

ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
