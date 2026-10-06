-- MSG-02: message requests. A member may let everyone message them: members
-- they follow reach the inbox, and anyone else's first message lands in
-- Requests as a PENDING conversation until it is accepted or declined. Every
-- conversation that exists is already accepted, which is the default.
--
-- The realtime trigger (MSG-06) announces `conversations` when a request is
-- accepted (to both members) or declined (to the recipient only: the sender
-- is never told).
--
-- Idempotent, because production runs migrate deploy on every deploy.

ALTER TYPE "MessagePermission" ADD VALUE IF NOT EXISTS 'EVERYONE';

DO $$ BEGIN
  CREATE TYPE "ConversationStatus" AS ENUM ('ACCEPTED', 'PENDING', 'DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "status" "ConversationStatus" NOT NULL DEFAULT 'ACCEPTED';
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3);

CREATE OR REPLACE FUNCTION "ss_realtime_conversation_status_signal"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  participant RECORD;
BEGIN
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NULL;
  END IF;
  FOR participant IN
    SELECT "userId" FROM "ConversationParticipant"
    WHERE "conversationId" = NEW."id"
      AND (NEW."status" <> 'DECLINED' OR "userId" IS DISTINCT FROM NEW."startedById")
  LOOP
    PERFORM pg_notify(
      'ss_realtime',
      json_build_object('u', participant."userId", 't', 'conversations')::text
    );
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER "Conversation_realtime_signal_status"
  AFTER UPDATE OF "status" ON "Conversation"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_conversation_status_signal"();
