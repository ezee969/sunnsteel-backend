-- SCHED-06: the weekdays a rotation routine trains on (empty: any day).
ALTER TABLE "Routine" ADD COLUMN "rotationWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
