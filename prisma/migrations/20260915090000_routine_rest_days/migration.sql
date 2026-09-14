-- SCHED-07: weekdays (0=Sun..6=Sat) a weekly routine rests on by plan.
-- Never one of its training weekdays and always empty on a rotation; both
-- rules are enforced by normalizeRestDays. Existing routines start with none.
-- AlterTable
ALTER TABLE "Routine" ADD COLUMN "restDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
