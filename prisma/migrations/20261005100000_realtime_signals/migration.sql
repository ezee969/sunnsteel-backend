-- MSG-06: the database announces that a member's notifications changed.
--
-- Notifications are gathered when the list is read, from the rows below, so
-- the moment one of them is written is the moment the bell is out of date.
-- `pg_notify` inside a transaction is delivered only when it commits, and
-- Postgres folds identical payloads of one transaction into one, so a
-- rolled-back write announces nothing and a rebuild writing hundreds of
-- events for one member announces once. Every write path -- present and
-- future -- is covered without knowing realtime exists. The payload names the
-- member and the topic only; the client re-reads through the API.
--
-- `ON CONFLICT DO NOTHING` (Prisma's `skipDuplicates`) fires no row trigger
-- for a skipped row, so re-gathering what already exists stays silent.
--
-- Idempotent: the function and every trigger are created or replaced.

CREATE OR REPLACE FUNCTION "ss_realtime_signal"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- TG_ARGV[0]: the column holding the member to tell; TG_ARGV[1]: the topic.
  PERFORM pg_notify(
    'ss_realtime',
    json_build_object('u', to_jsonb(NEW) ->> TG_ARGV[0], 't', TG_ARGV[1])::text
  );
  RETURN NULL;
END;
$$;

-- A new follower.
CREATE OR REPLACE TRIGGER "Follow_realtime_signal"
  AFTER INSERT ON "Follow"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_signal"('followingId', 'notifications');

-- A comment on the member's activity by somebody else.
CREATE OR REPLACE TRIGGER "ActivityComment_realtime_signal"
  AFTER INSERT ON "ActivityComment"
  FOR EACH ROW WHEN (NEW."authorId" <> NEW."userId")
  EXECUTE FUNCTION "ss_realtime_signal"('authorId', 'notifications');

-- The member's own achievements, records and progressions, written by the
-- analytics worker after a session.
CREATE OR REPLACE TRIGGER "TrainingEvent_realtime_signal"
  AFTER INSERT ON "TrainingEvent"
  FOR EACH ROW WHEN (
    NEW."type"::text IN ('ACHIEVEMENT_UNLOCKED', 'PERSONAL_RECORD', 'PROGRESSION_CHANGED')
  )
  EXECUTE FUNCTION "ss_realtime_signal"('userId', 'notifications');

-- Rows written directly: encouragements and partner activity, and a partner
-- alert withdrawn or restored with its source.
CREATE OR REPLACE TRIGGER "Notification_realtime_signal_insert"
  AFTER INSERT ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION "ss_realtime_signal"('userId', 'notifications');

CREATE OR REPLACE TRIGGER "Notification_realtime_signal_revoke"
  AFTER UPDATE OF "revokedAt" ON "Notification"
  FOR EACH ROW WHEN (OLD."revokedAt" IS DISTINCT FROM NEW."revokedAt")
  EXECUTE FUNCTION "ss_realtime_signal"('userId', 'notifications');
