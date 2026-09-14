-- PREF-05: per-account minimum sessions without a new best before the
-- plateau watch (PROG-09) flags a lift. The bounds mirror
-- PLATEAU_MIN_SESSIONS_MIN/MAX in @sunsteel/contracts; 4 is the default.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "plateauMinSessions" INTEGER NOT NULL DEFAULT 4;

ALTER TABLE "User" ADD CONSTRAINT "user_plateau_min_sessions_range"
  CHECK ("plateauMinSessions" BETWEEN 3 AND 8);
