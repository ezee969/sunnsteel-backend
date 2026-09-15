-- CreateEnum
CREATE TYPE "RoutineVersionKind" AS ENUM ('SAVED', 'BEFORE_RESTORE');

-- AlterTable
ALTER TABLE "Routine" ADD COLUMN "lastVersionNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RoutineVersion" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" VARCHAR(60),
    "kind" "RoutineVersionKind" NOT NULL DEFAULT 'SAVED',
    "restoredVersionNumber" INTEGER,
    "setup" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutineVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoutineVersion_routineId_number_key" ON "RoutineVersion"("routineId", "number");

-- AddForeignKey
ALTER TABLE "RoutineVersion" ADD CONSTRAINT "RoutineVersion_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
