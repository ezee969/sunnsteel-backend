-- MSG-01: one-to-one conversations of text, and who may start one.
--
-- Every account starts at FOLLOWED (members it follows may start a
-- conversation with it), the owner's default. A conversation is one row per
-- pair (`pairKey`), two participant rows and its messages; a deleted message
-- keeps its row with the text gone. Account deletion cascades the member's
-- participant row and messages, and the service clears the other side's
-- messages in the same transaction (the owner's decision 8).
--
-- The realtime triggers (MSG-06) announce the `conversations` topic to each
-- participant when a message is written or deleted, to a participant's other
-- tabs when they delete the conversation for themselves, to the one who stays
-- when the other's account is deleted, and to both members of a block or an
-- unblock, which hides or restores their conversation.
--
-- Idempotent, because production runs migrate deploy on every deploy.

DO $$ BEGIN
  CREATE TYPE "MessagePermission" AS ENUM ('FOLLOWED', 'NOBODY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "messagePermission" "MessagePermission" NOT NULL DEFAULT 'FOLLOWED';

CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL,
    "pairKey" VARCHAR(73) NOT NULL,
    "startedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConversationParticipant" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("conversationId","userId")
);

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" VARCHAR(2000),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_pairKey_key" ON "Conversation"("pairKey");
CREATE INDEX IF NOT EXISTS "Conversation_startedById_createdAt_idx" ON "Conversation"("startedById", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Realtime: every participant of the message's conversation.
CREATE OR REPLACE FUNCTION "ss_realtime_message_signal"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  participant RECORD;
BEGIN
  FOR participant IN
    SELECT "userId" FROM "ConversationParticipant"
    WHERE "conversationId" = NEW."conversationId"
  LOOP
    PERFORM pg_notify(
      'ss_realtime',
      json_build_object('u', participant."userId", 't', 'conversations')::text
    );
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER "Message_realtime_signal"
  AFTER INSERT OR UPDATE OF "deletedAt" ON "Message"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_message_signal"();

-- Realtime: a participant clearing the conversation (their other tabs), and a
-- participant leaving with their account (the one who stays).
CREATE OR REPLACE FUNCTION "ss_realtime_participant_signal"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  participant RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR participant IN
      SELECT "userId" FROM "ConversationParticipant"
      WHERE "conversationId" = OLD."conversationId"
    LOOP
      PERFORM pg_notify(
        'ss_realtime',
        json_build_object('u', participant."userId", 't', 'conversations')::text
      );
    END LOOP;
  ELSE
    PERFORM pg_notify(
      'ss_realtime',
      json_build_object('u', NEW."userId", 't', 'conversations')::text
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER "ConversationParticipant_realtime_signal_clear"
  AFTER UPDATE OF "clearedAt" ON "ConversationParticipant"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_participant_signal"();

CREATE OR REPLACE TRIGGER "ConversationParticipant_realtime_signal_leave"
  AFTER DELETE ON "ConversationParticipant"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_participant_signal"();

-- Realtime: a block or an unblock hides or restores the pair's conversation.
CREATE OR REPLACE FUNCTION "ss_realtime_block_signal"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('ss_realtime', json_build_object('u', OLD."blockerId", 't', 'conversations')::text);
    PERFORM pg_notify('ss_realtime', json_build_object('u', OLD."blockedId", 't', 'conversations')::text);
  ELSE
    PERFORM pg_notify('ss_realtime', json_build_object('u', NEW."blockerId", 't', 'conversations')::text);
    PERFORM pg_notify('ss_realtime', json_build_object('u', NEW."blockedId", 't', 'conversations')::text);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER "UserBlock_realtime_signal"
  AFTER INSERT OR DELETE ON "UserBlock"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_block_signal"();
