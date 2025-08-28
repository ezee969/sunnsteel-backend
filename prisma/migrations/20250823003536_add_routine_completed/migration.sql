-- AlterTable
ALTER TABLE "Routine" ADD COLUMN     "isCompleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Routine_userId_isCompleted_idx" ON "Routine"("userId", "isCompleted");
