-- Enforce at most one IN_PROGRESS workout session per user
-- Uses a partial unique index (PostgreSQL) on (userId) where status = 'IN_PROGRESS'
-- Safe to rerun with IF NOT EXISTS guard.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_session_per_user
ON "WorkoutSession"("userId")
WHERE status = 'IN_PROGRESS';
