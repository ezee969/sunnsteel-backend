-- ROUT-16: temporary deload overrides. A deload is a bounded, explicitly
-- lighter copy of the prescription in force on its dates, trained through its
-- own working-copy days (RoutineDay.temporaryOverrideId). Idempotent.

DO $$ BEGIN
  CREATE TYPE "TemporaryOverrideKind" AS ENUM ('DELOAD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "DeloadSetMode" AS ENUM ('ALL', 'HALF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "TemporaryOverrideSourceKind" AS ENUM ('BASELINE', 'TRAINING_BLOCK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RoutineTemporaryOverride" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "kind" "TemporaryOverrideKind" NOT NULL DEFAULT 'DELOAD',
    "startDate" VARCHAR(10) NOT NULL,
    "endDate" VARCHAR(10) NOT NULL,
    "loadReductionPercent" INTEGER NOT NULL,
    "setMode" "DeloadSetMode" NOT NULL,
    "sourceKind" "TemporaryOverrideSourceKind" NOT NULL,
    "sourceTrainingBlockSeriesId" TEXT,
    "sourceTrainingBlockName" VARCHAR(60),
    "originalSetup" JSONB NOT NULL,
    "setup" JSONB NOT NULL,
    "endedEarlyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoutineTemporaryOverride_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RoutineTemporaryOverride_routineId_startDate_idx"
ON "RoutineTemporaryOverride"("routineId", "startDate");
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RoutineTemporaryOverride_routineId_fkey'
  ) THEN
    ALTER TABLE "RoutineTemporaryOverride"
    ADD CONSTRAINT "RoutineTemporaryOverride_routineId_fkey"
    FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "RoutineDay" ADD COLUMN IF NOT EXISTS "temporaryOverrideId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RoutineDay_temporaryOverrideId_fkey'
  ) THEN
    ALTER TABLE "RoutineDay"
    ADD CONSTRAINT "RoutineDay_temporaryOverrideId_fkey"
    FOREIGN KEY ("temporaryOverrideId") REFERENCES "RoutineTemporaryOverride"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "RoutineDay_temporaryOverrideId_idx"
ON "RoutineDay"("temporaryOverrideId");

-- A deload's days are neither baseline nor block days, so the baseline's
-- weekday uniqueness must exclude them and they get their own.
DROP INDEX IF EXISTS "RoutineDay_baseline_dayOfWeek_key";
CREATE UNIQUE INDEX IF NOT EXISTS "RoutineDay_baseline_dayOfWeek_v2_key"
ON "RoutineDay"("routineId", "dayOfWeek")
WHERE "trainingBlockId" IS NULL AND "temporaryOverrideId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "RoutineDay_override_dayOfWeek_key"
ON "RoutineDay"("temporaryOverrideId", "dayOfWeek")
WHERE "temporaryOverrideId" IS NOT NULL;

ALTER TABLE "WorkoutSession" ADD COLUMN IF NOT EXISTS "temporaryOverrideId" TEXT;
ALTER TABLE "WorkoutSession" ADD COLUMN IF NOT EXISTS "temporaryOverrideKind" "TemporaryOverrideKind";
