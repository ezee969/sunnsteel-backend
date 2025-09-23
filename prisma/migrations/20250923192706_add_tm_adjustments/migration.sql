-- CreateTable
CREATE TABLE "TmAdjustment" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "deltaKg" DOUBLE PRECISION NOT NULL,
    "preTmKg" DOUBLE PRECISION NOT NULL,
    "postTmKg" DOUBLE PRECISION NOT NULL,
    "reason" VARCHAR(160),
    "style" "ProgramStyle",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TmAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TmAdjustment_routineId_exerciseId_createdAt_idx" ON "TmAdjustment"("routineId", "exerciseId", "createdAt");

-- CreateIndex
CREATE INDEX "TmAdjustment_routineId_weekNumber_idx" ON "TmAdjustment"("routineId", "weekNumber");

-- AddForeignKey
ALTER TABLE "TmAdjustment" ADD CONSTRAINT "TmAdjustment_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
