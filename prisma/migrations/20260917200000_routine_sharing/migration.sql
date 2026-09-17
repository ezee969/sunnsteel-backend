-- ROUT-04: per-routine visibility and revocable share links.
-- Every existing routine stays exactly as private as it is today.
CREATE TYPE "RoutineVisibility" AS ENUM ('PRIVATE', 'FOLLOWERS', 'PUBLIC');

ALTER TABLE "Routine"
  ADD COLUMN "visibility" "RoutineVisibility" NOT NULL DEFAULT 'PRIVATE';

-- The token is the only credential a link carries, as in SOC-07's SessionShare.
CREATE TABLE "RoutineShare" (
    "id" TEXT NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "routineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RoutineShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoutineShare_token_key" ON "RoutineShare"("token");
CREATE INDEX "RoutineShare_routineId_revokedAt_idx" ON "RoutineShare"("routineId", "revokedAt");
CREATE INDEX "RoutineShare_userId_idx" ON "RoutineShare"("userId");

ALTER TABLE "RoutineShare" ADD CONSTRAINT "RoutineShare_routineId_fkey"
  FOREIGN KEY ("routineId") REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoutineShare" ADD CONSTRAINT "RoutineShare_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
