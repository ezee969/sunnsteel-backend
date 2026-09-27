-- PROG-12: dated body weight and measurements, one entry per member per local
-- date, and who may see that history on the member's profile.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bodyProgressVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE';

CREATE TABLE IF NOT EXISTS "BodyMeasurement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "waistCm" DOUBLE PRECISION,
    "hipsCm" DOUBLE PRECISION,
    "chestCm" DOUBLE PRECISION,
    "armCm" DOUBLE PRECISION,
    "thighCm" DOUBLE PRECISION,
    "bodyFatPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BodyMeasurement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BodyMeasurement_userId_date_key" ON "BodyMeasurement"("userId", "date");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BodyMeasurement_userId_fkey') THEN
    ALTER TABLE "BodyMeasurement" ADD CONSTRAINT "BodyMeasurement_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Every member with a current weight starts with it as one entry, dated the
-- day it was last saved, so the history does not open empty.
INSERT INTO "BodyMeasurement" ("id", "userId", "date", "weightKg", "updatedAt")
SELECT gen_random_uuid()::text, "id", ("updatedAt" AT TIME ZONE 'UTC')::date, "weight", CURRENT_TIMESTAMP
FROM "User"
WHERE "weight" IS NOT NULL AND "weight" BETWEEN 20 AND 1000
ON CONFLICT ("userId", "date") DO NOTHING;
