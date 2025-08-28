/*
  Warnings:

  - Added the required column `equipment` to the `Exercise` table without a default value. This is not possible if the table is not empty.
  - Added the required column `primaryMuscle` to the `Exercise` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "equipment" TEXT NOT NULL,
ADD COLUMN     "primaryMuscle" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Routine" ADD COLUMN     "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Routine_userId_isFavorite_idx" ON "Routine"("userId", "isFavorite");
