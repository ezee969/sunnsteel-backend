-- MSG-03: unread state. Each participant gets a read position, for that
-- reader only: a conversation is unread while the other member wrote
-- something after it that is neither deleted nor removed for this reader.
--
-- The column is added with every existing participant marked as having read
-- up to the conversation's newest message, so deploying this does not light
-- up every conversation at once. The backfill runs only in the statement that
-- adds the column, because a second run must not mark as read a conversation
-- that became unread since.
--
-- The realtime trigger (MSG-06) also announces `conversations` to a reader
-- when their read position moves, so their other tabs drop the count.
--
-- Idempotent, because production runs migrate deploy on every deploy.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ConversationParticipant' AND column_name = 'lastReadAt'
  ) THEN
    ALTER TABLE "ConversationParticipant" ADD COLUMN "lastReadAt" TIMESTAMP(3);
    UPDATE "ConversationParticipant" p
    SET "lastReadAt" = c."lastMessageAt"
    FROM "Conversation" c
    WHERE c."id" = p."conversationId";
  END IF;
END $$;

CREATE OR REPLACE TRIGGER "ConversationParticipant_realtime_signal_clear"
  AFTER UPDATE OF "clearedAt", "lastReadAt" ON "ConversationParticipant"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_participant_signal"();
