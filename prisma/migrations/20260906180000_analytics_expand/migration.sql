-- CreateEnum
CREATE TYPE "TrainingEventType" AS ENUM ('SESSION_COMPLETED', 'PERSONAL_RECORD');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timeZone" TEXT;

-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "completedSets" INTEGER,
ADD COLUMN     "sourceRoutineDayId" TEXT,
ADD COLUMN     "sourceRoutineId" TEXT,
ADD COLUMN     "totalVolumeKg" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "SetLog" ADD COLUMN     "sourceRoutineExerciseId" TEXT;

-- CreateTable
CREATE TABLE "WorkoutSessionSnapshot" (
    "sessionId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "provenance" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutSessionSnapshot_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "TrainingEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "TrainingEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,

    CONSTRAINT "TrainingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "setLogId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "reps" INTEGER NOT NULL,
    "estimated1rm" DOUBLE PRECISION NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutAnalyticsProjection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "timeZone" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'BUILDING',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "totalVolumeKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedSessions" INTEGER NOT NULL DEFAULT 0,
    "completedSets" INTEGER NOT NULL DEFAULT 0,
    "lastTrainingDate" TEXT,
    "currentRun" INTEGER NOT NULL DEFAULT 0,
    "bestRun" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutAnalyticsProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutRollup" (
    "projectionId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "volumeKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedSets" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "activeDays" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkoutRollup_pkey" PRIMARY KEY ("projectionId","period","date")
);

-- CreateTable
CREATE TABLE "AnalyticsRecordFrontier" (
    "projectionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "reps" INTEGER NOT NULL,

    CONSTRAINT "AnalyticsRecordFrontier_pkey" PRIMARY KEY ("projectionId","exerciseId")
);

-- CreateTable
CREATE TABLE "WorkoutMuscleRollup" (
    "projectionId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "muscle" TEXT NOT NULL,
    "volumeKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedSets" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "WorkoutMuscleRollup_pkey" PRIMARY KEY ("projectionId","period","date","muscle")
);

-- CreateTable
CREATE TABLE "AnalyticsBackfillJob" (
    "id" TEXT NOT NULL,
    "projectionId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "cursorEndedAt" TIMESTAMP(3),
    "cursorSessionId" TEXT,
    "snapshotCursorSessionId" TEXT,
    "snapshotsComplete" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "approximatedSessions" INTEGER NOT NULL DEFAULT 0,
    "processedSessions" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsBackfillJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEvent_eventKey_key" ON "TrainingEvent"("eventKey");

-- CreateIndex
CREATE INDEX "TrainingEvent_userId_occurredAt_id_idx" ON "TrainingEvent"("userId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "PersonalRecord_userId_achievedAt_idx" ON "PersonalRecord"("userId", "achievedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalRecord_userId_exerciseId_key" ON "PersonalRecord"("userId", "exerciseId");

-- CreateIndex
CREATE INDEX "WorkoutAnalyticsProjection_userId_createdAt_idx" ON "WorkoutAnalyticsProjection"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsBackfillJob_projectionId_key" ON "AnalyticsBackfillJob"("projectionId");

-- CreateIndex
CREATE INDEX "AnalyticsBackfillJob_state_updatedAt_idx" ON "AnalyticsBackfillJob"("state", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkoutSession_userId_id_idx" ON "WorkoutSession"("userId", "id");

-- AddForeignKey
ALTER TABLE "WorkoutSessionSnapshot" ADD CONSTRAINT "WorkoutSessionSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEvent" ADD CONSTRAINT "TrainingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalRecord" ADD CONSTRAINT "PersonalRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutAnalyticsProjection" ADD CONSTRAINT "WorkoutAnalyticsProjection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutRollup" ADD CONSTRAINT "WorkoutRollup_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "WorkoutAnalyticsProjection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsRecordFrontier" ADD CONSTRAINT "AnalyticsRecordFrontier_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "WorkoutAnalyticsProjection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutMuscleRollup" ADD CONSTRAINT "WorkoutMuscleRollup_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "WorkoutAnalyticsProjection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsBackfillJob" ADD CONSTRAINT "AnalyticsBackfillJob_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "WorkoutAnalyticsProjection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma does not represent these partial indexes. Keep them in SQL migrations.
CREATE UNIQUE INDEX "analytics_one_active_user" ON "WorkoutAnalyticsProjection" ("userId") WHERE "active";
CREATE UNIQUE INDEX "analytics_one_building_user" ON "WorkoutAnalyticsProjection" ("userId") WHERE "state" = 'BUILDING';
CREATE INDEX "workout_recent_completed_sets" ON "WorkoutSession" ("userId", "endedAt" DESC, "id" DESC) WHERE "status" = 'COMPLETED' AND "completedSets" > 0;
CREATE INDEX "workout_analytics_backfill_cursor" ON "WorkoutSession" ("userId", "endedAt", "id") WHERE "status" = 'COMPLETED' AND "endedAt" IS NOT NULL;
ALTER TABLE "WorkoutAnalyticsProjection" ADD CONSTRAINT "analytics_active_ready" CHECK (NOT "active" OR "state" = 'READY');

CREATE UNIQUE INDEX "SetLog_sessionId_sourceRoutineExerciseId_setNumber_key" ON "SetLog" ("sessionId", "sourceRoutineExerciseId", "setNumber");

-- Non-partial cursor index also covers ORM enum casts in the offline backfill.
CREATE INDEX "workout_analytics_cursor_status" ON "WorkoutSession" ("userId", "status", "endedAt", "id");

ALTER TABLE "User" ADD COLUMN "analyticsProjectionId" TEXT;
