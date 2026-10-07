-- MSG-08: message notifications. A Messages push category, on by default
-- like the training categories, and the last time a participant was pushed
-- for a conversation, so a conversation pushes once until it is read.
--
-- Idempotent, because production runs migrate deploy on every deploy.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notifyMessages" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ConversationParticipant" ADD COLUMN IF NOT EXISTS "lastPushedAt" TIMESTAMP(3);
