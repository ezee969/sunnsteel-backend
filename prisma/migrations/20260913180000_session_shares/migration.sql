-- CreateTable
CREATE TABLE "SessionShare" (
    "id" TEXT NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SessionShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionShare_token_key" ON "SessionShare"("token");

-- CreateIndex
CREATE INDEX "SessionShare_sessionId_revokedAt_idx" ON "SessionShare"("sessionId", "revokedAt");

-- CreateIndex
CREATE INDEX "SessionShare_userId_idx" ON "SessionShare"("userId");

-- AddForeignKey
ALTER TABLE "SessionShare" ADD CONSTRAINT "SessionShare_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionShare" ADD CONSTRAINT "SessionShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

