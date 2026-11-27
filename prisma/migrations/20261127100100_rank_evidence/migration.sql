-- ACH-12: the rank counts a session only when it holds at least one completed
-- work set (a warm-up is not one), and an active week only when it holds such
-- a session. Every rank a member holds now is kept: it is recorded under the
-- rule in force until now before anything is counted the new way. Safe to run
-- twice: the record is keyed per account and rank, and the counts are set,
-- never incremented.

ALTER TABLE "WorkoutAnalyticsProjection"
  ADD COLUMN IF NOT EXISTS "countedSessions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkoutRollup"
  ADD COLUMN IF NOT EXISTS "countedSessions" INTEGER NOT NULL DEFAULT 0;

-- 1. Every rank held today, from the active projection under the old rule:
-- completed sessions, and weeks with any completed session. Dynamic SQL run
-- only when someone holds a rank above Initiate, so a fresh database (where
-- every migration runs in one script) never touches the new enum value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "WorkoutAnalyticsProjection"
    WHERE "active" AND "state" = 'READY' AND "completedSessions" >= 5
  ) THEN
    EXECUTE $sql$
      WITH ladder (rank_id, min_sessions, min_weeks) AS (
        VALUES
          ('APPRENTICE', 5, 3),
          ('ARTISAN', 15, 8),
          ('MAESTRO', 30, 16),
          ('VIRTUOSO', 60, 32),
          ('LAUREATE', 100, 52)
      ),
      totals AS (
        SELECT
          p."userId" AS user_id,
          p."completedSessions" AS sessions,
          (
            SELECT count(*) FROM "WorkoutRollup" r
            WHERE r."projectionId" = p."id"
              AND r."period" = 'WEEK'
              AND r."sessions" > 0
          ) AS weeks
        FROM "WorkoutAnalyticsProjection" p
        WHERE p."active" AND p."state" = 'READY'
      )
      INSERT INTO "TrainingEvent"
        ("id", "eventKey", "userId", "sessionId", "type", "occurredAt",
         "schemaVersion", "payload")
      SELECT
        gen_random_uuid()::text,
        'rank:' || t.user_id || ':' || l.rank_id || ':v1',
        t.user_id,
        NULL,
        'RANK_REACHED'::"TrainingEventType",
        now(),
        1,
        jsonb_build_object(
          'schemaVersion', 1,
          'rankId', l.rank_id,
          'backfilled', true
        )
      FROM totals t
      JOIN ladder l
        ON t.sessions >= l.min_sessions AND t.weeks >= l.min_weeks
      ON CONFLICT ("eventKey") DO NOTHING
    $sql$;
  END IF;
END $$;

-- 2. Counted sessions per projection, local day and Monday week, read from
-- the sessions each projection has applied: all of them for a READY one, up
-- to the job's cursor for one still BUILDING (which counts the rest itself).
DROP TABLE IF EXISTS "_rank_counted";
CREATE TEMP TABLE "_rank_counted" AS
SELECT
  p."id" AS projection_id,
  ((s."endedAt" AT TIME ZONE 'UTC') AT TIME ZONE p."timeZone") AS local_end
FROM "WorkoutAnalyticsProjection" p
JOIN "WorkoutSession" s ON s."userId" = p."userId"
LEFT JOIN "AnalyticsBackfillJob" j ON j."projectionId" = p."id"
WHERE s."status" = 'COMPLETED'
  AND s."endedAt" IS NOT NULL
  AND (
    (p."state" = 'READY' AND p."active")
    OR (
      p."state" = 'BUILDING'
      AND j."cursorEndedAt" IS NOT NULL
      AND (s."endedAt", s."id") <= (j."cursorEndedAt", j."cursorSessionId")
    )
  )
  AND EXISTS (
    SELECT 1 FROM "SetLog" l
    WHERE l."sessionId" = s."id"
      AND l."isCompleted"
      AND l."kind" <> 'WARMUP'
  );

UPDATE "WorkoutAnalyticsProjection" p
SET "countedSessions" = c.n
FROM (
  SELECT projection_id, count(*)::int AS n
  FROM "_rank_counted" GROUP BY projection_id
) c
WHERE p."id" = c.projection_id;

UPDATE "WorkoutRollup" r
SET "countedSessions" = c.n
FROM (
  SELECT projection_id, to_char(local_end, 'YYYY-MM-DD') AS date,
         count(*)::int AS n
  FROM "_rank_counted" GROUP BY 1, 2
) c
WHERE r."projectionId" = c.projection_id
  AND r."period" = 'DAY'
  AND r."date" = c.date;

UPDATE "WorkoutRollup" r
SET "countedSessions" = c.n
FROM (
  SELECT projection_id,
         to_char(date_trunc('week', local_end), 'YYYY-MM-DD') AS date,
         count(*)::int AS n
  FROM "_rank_counted" GROUP BY 1, 2
) c
WHERE r."projectionId" = c.projection_id
  AND r."period" = 'WEEK'
  AND r."date" = c.date;

DROP TABLE "_rank_counted";
