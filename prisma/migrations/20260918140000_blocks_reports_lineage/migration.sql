-- PROF-10: symmetric blocks and recorded reports.
-- One row per block, from blocker to blocked; every read treats it as mutual.
CREATE TABLE "UserBlock" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId", "blockedId")
);

CREATE INDEX "UserBlock_blockerId_idx" ON "UserBlock"("blockerId");
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey"
  FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "ReportSubjectKind" AS ENUM ('MEMBER', 'ROUTINE', 'SESSION');
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'IMPERSONATION', 'UNSAFE_ADVICE', 'SEXUAL_CONTENT', 'OTHER');

CREATE TABLE "MemberReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "subjectKind" "ReportSubjectKind" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberReport_reporterId_createdAt_idx" ON "MemberReport"("reporterId", "createdAt");
CREATE INDEX "MemberReport_subjectKind_subjectId_idx" ON "MemberReport"("subjectKind", "subjectId");

ALTER TABLE "MemberReport" ADD CONSTRAINT "MemberReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ROUT-06: what a cloned routine came from. Both references are SET NULL, so
-- deleting a source never deletes somebody else's copy of it.
ALTER TABLE "Routine"
  ADD COLUMN "clonedFromRoutineId" TEXT,
  ADD COLUMN "clonedFromUserId" TEXT,
  ADD COLUMN "clonedAt" TIMESTAMP(3);

CREATE INDEX "Routine_clonedFromRoutineId_idx" ON "Routine"("clonedFromRoutineId");

ALTER TABLE "Routine" ADD CONSTRAINT "Routine_clonedFromRoutineId_fkey"
  FOREIGN KEY ("clonedFromRoutineId") REFERENCES "Routine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_clonedFromUserId_fkey"
  FOREIGN KEY ("clonedFromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
