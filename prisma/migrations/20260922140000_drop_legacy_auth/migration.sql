-- TD-47. Removes the pre-Supabase authentication storage.
--
-- Safe because production was queried first, on 2026-09-22, through a
-- temporary counting probe (the database is private, so it could not be
-- queried from outside): of 7 accounts, 0 had a password and 0 were stranded
-- on one -- a password with no Supabase identity to sign in with instead.
-- Nobody loses a way in.
--
-- Both tables go rather than being emptied: nothing has written to either
-- since Supabase took over authentication. "BlacklistedToken" was read only by
-- a nightly job that deleted expired rows from a table with no writer, and
-- "RefreshToken" by token machinery with no callers at all.
--
-- Written with IF EXISTS so a re-run is a no-op: production applies migrations
-- in a pre-deploy hook, and CI runs the whole chain twice to prove exactly
-- that.

DROP TABLE IF EXISTS "BlacklistedToken";
DROP TABLE IF EXISTS "RefreshToken";

ALTER TABLE "User" DROP COLUMN IF EXISTS "password";
