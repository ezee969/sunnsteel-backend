-- ROUT-09: authored, dated routine setups. Rows are immutable revisions; the
-- current row in a series is the one without supersededAt.
CREATE TYPE "RoutineTrainingBlockSourceKind" AS ENUM ('CURRENT_ROUTINE', 'SAVED_VERSION');

CREATE TABLE "RoutineTrainingBlock" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "startDate" VARCHAR(10) NOT NULL,
    "endDate" VARCHAR(10) NOT NULL,
    "setup" JSONB NOT NULL,
    "sourceKind" "RoutineTrainingBlockSourceKind" NOT NULL,
    "sourceVersionId" TEXT,
    "sourceVersionNumber" INTEGER,
    "sourceVersionName" VARCHAR(60),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutineTrainingBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoutineTrainingBlock_seriesId_revision_key"
ON "RoutineTrainingBlock"("seriesId", "revision");

CREATE INDEX "RoutineTrainingBlock_routineId_supersededAt_startDate_idx"
ON "RoutineTrainingBlock"("routineId", "supersededAt", "startDate");

CREATE INDEX "RoutineTrainingBlock_sourceVersionId_idx"
ON "RoutineTrainingBlock"("sourceVersionId");

ALTER TABLE "RoutineTrainingBlock"
ADD CONSTRAINT "RoutineTrainingBlock_routineId_fkey"
FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoutineTrainingBlock"
ADD CONSTRAINT "RoutineTrainingBlock_sourceVersionId_fkey"
FOREIGN KEY ("sourceVersionId") REFERENCES "RoutineVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
