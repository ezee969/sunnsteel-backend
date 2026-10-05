-- MSG-09: reporting and moderation of messages.
--
-- A message can be reported (ReportSubjectKind MESSAGE). The report captures
-- the reported message and up to five before it, as the reporter could see
-- them, in ReportedMessageCapture: it outlives the author deleting the message
-- and goes with the author's account (and with the report). A moderator can
-- hide one message from the other participant (Message.moderationHiddenAt) and
-- restrict an account's messaging (User.messagingRestrictedAt), each recorded
-- in ModerationAction with the two new kinds.
--
-- The realtime triggers (MSG-06) now also announce `conversations` when a
-- message is hidden or restored, and to a member whose messaging is
-- restricted or lifted, so an open thread re-reads and swaps its composer.
--
-- Idempotent, because production runs migrate deploy on every deploy.

ALTER TYPE "ReportSubjectKind" ADD VALUE IF NOT EXISTS 'MESSAGE';
ALTER TYPE "ModerationActionKind" ADD VALUE IF NOT EXISTS 'RESTRICT_MESSAGING';
ALTER TYPE "ModerationActionKind" ADD VALUE IF NOT EXISTS 'LIFT_MESSAGING_RESTRICTION';

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "moderationHiddenAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "messagingRestrictedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ReportedMessageCapture" (
    "reportId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportedMessageCapture_pkey" PRIMARY KEY ("reportId")
);

CREATE INDEX IF NOT EXISTS "ReportedMessageCapture_authorId_idx" ON "ReportedMessageCapture"("authorId");
CREATE INDEX IF NOT EXISTS "ReportedMessageCapture_messageId_idx" ON "ReportedMessageCapture"("messageId");

DO $$ BEGIN
  ALTER TABLE "ReportedMessageCapture" ADD CONSTRAINT "ReportedMessageCapture_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "MemberReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReportedMessageCapture" ADD CONSTRAINT "ReportedMessageCapture_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Realtime: a hide or a restore changes what the other participant reads.
CREATE OR REPLACE TRIGGER "Message_realtime_signal"
  AFTER INSERT OR UPDATE OF "deletedAt", "moderationHiddenAt" ON "Message"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_message_signal"();

-- Realtime: a restriction or its lift, to the member alone.
CREATE OR REPLACE FUNCTION "ss_realtime_messaging_restriction_signal"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."messagingRestrictedAt" IS DISTINCT FROM OLD."messagingRestrictedAt" THEN
    PERFORM pg_notify(
      'ss_realtime',
      json_build_object('u', NEW."id", 't', 'conversations')::text
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER "User_realtime_signal_messaging_restriction"
  AFTER UPDATE OF "messagingRestrictedAt" ON "User"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_messaging_restriction_signal"();
