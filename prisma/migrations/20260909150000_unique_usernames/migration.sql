ALTER TABLE "User" ADD COLUMN "username" VARCHAR(30);

UPDATE "User"
SET "username" = 'member_' || substring(md5("id") from 1 for 16);

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

ALTER TABLE "User"
ADD CONSTRAINT "User_username_format_check"
CHECK (
  "username" = lower("username")
  AND "username" ~ '^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$'
);
