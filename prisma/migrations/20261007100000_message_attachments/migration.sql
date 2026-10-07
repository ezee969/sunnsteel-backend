-- MSG-07: a message can carry one of its sender's routines.
--
-- The reference is typed (`attachmentKind`) and deliberately not a foreign
-- key: the routine is resolved when the message is read, so a deleted routine
-- reads as no longer available rather than taking the message with it, and
-- MSG-10 adds further kinds without another column. The text becomes
-- optional beside it, which `body` already allows (null).

DO $$ BEGIN
  CREATE TYPE "MessageAttachmentKind" AS ENUM ('ROUTINE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "attachmentKind" "MessageAttachmentKind";
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "attachmentId" TEXT;
