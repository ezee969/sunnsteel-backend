-- NAV-03: the results a member last opened from search. A reference only:
-- targetId is resolved again on every read, so it is not a foreign key.
-- Idempotent, because production runs migrate deploy on every deploy.
DO $$ BEGIN
  CREATE TYPE "RecentSearchKind" AS ENUM ('MEMBER', 'EXERCISE', 'ROUTINE', 'WORKOUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "RecentSearch" (
    "userId" TEXT NOT NULL,
    "kind" "RecentSearchKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentSearch_pkey" PRIMARY KEY ("userId","kind","targetId")
);

CREATE INDEX IF NOT EXISTS "RecentSearch_userId_openedAt_idx" ON "RecentSearch"("userId", "openedAt");

DO $$ BEGIN
  ALTER TABLE "RecentSearch" ADD CONSTRAINT "RecentSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
