-- LIVE-17: saved corrections of a finished workout's set logs, append-only.
CREATE TABLE "SessionCorrection" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SessionCorrection_sessionId_createdAt_idx" ON "SessionCorrection"("sessionId", "createdAt");

CREATE INDEX "SessionCorrection_userId_idx" ON "SessionCorrection"("userId");

ALTER TABLE "SessionCorrection" ADD CONSTRAINT "SessionCorrection_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionCorrection" ADD CONSTRAINT "SessionCorrection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
