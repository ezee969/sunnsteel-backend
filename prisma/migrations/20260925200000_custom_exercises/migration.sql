-- EXER-06: members can create their own exercises. A catalog exercise has no
-- owner; a custom one belongs to one member and goes with their account.
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "note" VARCHAR(500);
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Exercise_ownerId_fkey') THEN
    ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Exercise_ownerId_idx" ON "Exercise"("ownerId");

-- Names: unique across the catalog, and per owner ignoring case. The service
-- also refuses a custom name that matches a catalog one. Prisma cannot
-- declare partial indexes, so the schema carries neither.
DROP INDEX IF EXISTS "Exercise_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Exercise_catalog_name_key"
  ON "Exercise"("name") WHERE "ownerId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Exercise_owner_name_key"
  ON "Exercise"("ownerId", lower("name")) WHERE "ownerId" IS NOT NULL;

-- An exercise now cascades from its owner, so nothing may restrict deleting
-- it (the account-deletion suite checks this). Catalog exercises are never
-- deleted, and a custom one only while no routine or workout uses it.
ALTER TABLE "RoutineExercise" DROP CONSTRAINT IF EXISTS "RoutineExercise_exerciseId_fkey";
ALTER TABLE "RoutineExercise" ADD CONSTRAINT "RoutineExercise_exerciseId_fkey"
  FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetLog" DROP CONSTRAINT IF EXISTS "SetLog_exerciseId_fkey";
ALTER TABLE "SetLog" ADD CONSTRAINT "SetLog_exerciseId_fkey"
  FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
