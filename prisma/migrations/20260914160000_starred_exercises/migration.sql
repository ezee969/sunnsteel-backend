-- EXER-07: private per-account stars on catalog exercises. They order the
-- owner's pickers and are separate from UserFavoriteExercise (PROF-05).
-- CreateTable
CREATE TABLE "StarredExercise" (
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StarredExercise_pkey" PRIMARY KEY ("userId","exerciseId")
);

-- CreateIndex
CREATE INDEX "StarredExercise_userId_createdAt_idx" ON "StarredExercise"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StarredExercise_exerciseId_idx" ON "StarredExercise"("exerciseId");

-- AddForeignKey
ALTER TABLE "StarredExercise" ADD CONSTRAINT "StarredExercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarredExercise" ADD CONSTRAINT "StarredExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

