-- PREF-04: the weekday a member's weeks start on and the unit lengths are
-- shown in. Every account keeps Monday and centimetres until it chooses, so
-- nothing is backfilled. Idempotent, because production runs migrate deploy
-- on every deploy.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weekStartsOn" INTEGER NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_weekStartsOn_check" CHECK ("weekStartsOn" IN (0, 1));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LengthUnit" AS ENUM ('CM', 'IN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lengthUnit" "LengthUnit" NOT NULL DEFAULT 'CM';
