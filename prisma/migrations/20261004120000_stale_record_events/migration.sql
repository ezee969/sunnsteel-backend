-- TD-58: remove PERSONAL_RECORD events that do not beat the best earlier
-- record of their exercise. A finish never writes one; an analytics replay can
-- leave one behind, because a rebuild only adds events. The portfolio seed
-- backdated heavier history into a real account, and the record one of that
-- account's own workouts had set before then stayed, reading as a record that
-- never happened and failing the progress timeline for the whole exercise.
--
-- The rule is `staleRecordEvents` in src/workouts/analytics/stale-record-events.ts:
-- walk each member's events per exercise in (occurredAt, id) order, and an
-- event that is not heavier than the best before it, or equal and with more
-- reps, goes. Once they are gone every remaining event beats the best before
-- it, so running this again removes nothing. A payload without numeric weight
-- and reps is left alone. The activity built on a removed event goes with it,
-- exactly as a LIVE-17 correction removes it: the comments on it (and their
-- notifications), the reactions and the owner's audience for it.

DROP TABLE IF EXISTS "td58_stale_record_events";

CREATE TEMP TABLE "td58_stale_record_events" AS
WITH records AS (
  SELECT
    "id",
    "userId",
    "eventKey",
    "occurredAt",
    "payload"->>'exerciseId' AS "exerciseId",
    ARRAY[
      CASE WHEN jsonb_typeof("payload"->'weight') = 'number'
        THEN ("payload"->>'weight')::float8 END,
      CASE WHEN jsonb_typeof("payload"->'reps') = 'number'
        THEN ("payload"->>'reps')::float8 END
    ] AS "value"
  FROM "TrainingEvent"
  WHERE "type" = 'PERSONAL_RECORD'
    AND jsonb_typeof("payload"->'exerciseId') = 'string'
    AND jsonb_typeof("payload"->'weight') = 'number'
    AND jsonb_typeof("payload"->'reps') = 'number'
), judged AS (
  SELECT
    records.*,
    max("value") OVER (
      PARTITION BY "userId", "exerciseId"
      ORDER BY "occurredAt", "id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS "bestBefore"
  FROM records
)
SELECT "id", "userId", "eventKey"
FROM judged
WHERE "bestBefore" IS NOT NULL
  AND NOT ("value" > "bestBefore");

DELETE FROM "Notification" n
USING "ActivityComment" c, "td58_stale_record_events" s
WHERE c."entryKey" = s."eventKey"
  AND c."authorId" = s."userId"
  AND n."userId" = s."userId"
  AND n."sourceKey" = 'comment:' || c."id";

DELETE FROM "ActivityComment" c
USING "td58_stale_record_events" s
WHERE c."entryKey" = s."eventKey"
  AND c."authorId" = s."userId";

DELETE FROM "ActivityEntryReaction" r
USING "td58_stale_record_events" s
WHERE r."entryKey" = s."eventKey"
  AND r."authorId" = s."userId";

DELETE FROM "ActivityEntryOverride" o
USING "td58_stale_record_events" s
WHERE o."entryKey" = s."eventKey"
  AND o."userId" = s."userId";

DELETE FROM "TrainingEvent" e
USING "td58_stale_record_events" s
WHERE e."id" = s."id";

DROP TABLE "td58_stale_record_events";
