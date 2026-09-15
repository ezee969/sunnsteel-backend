-- CreateEnum
CREATE TYPE "ScheduleOverrideKind" AS ENUM ('MOVE');

-- CreateTable
CREATE TABLE "ScheduleOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "kind" "ScheduleOverrideKind" NOT NULL DEFAULT 'MOVE',
    "toDate" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleOverride_userId_date_idx" ON "ScheduleOverride"("userId", "date");

-- CreateIndex
CREATE INDEX "ScheduleOverride_userId_toDate_idx" ON "ScheduleOverride"("userId", "toDate");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleOverride_routineId_date_key" ON "ScheduleOverride"("routineId", "date");

-- AddForeignKey
ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleOverride" ADD CONSTRAINT "ScheduleOverride_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

