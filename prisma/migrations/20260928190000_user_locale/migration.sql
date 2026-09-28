-- I18N-02: the account's language. Null follows each device, so nothing is
-- backfilled. The check keeps it to the languages contracts' SUPPORTED_LOCALES
-- names; adding one is a new migration.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "locale" TEXT;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_locale_check";
ALTER TABLE "User" ADD CONSTRAINT "User_locale_check" CHECK ("locale" IS NULL OR "locale" IN ('en', 'es'));
