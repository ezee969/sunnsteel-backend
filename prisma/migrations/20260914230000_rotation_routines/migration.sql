-- ROUT-11: a routine is WEEKLY (each day on a weekday, as before) or a
-- ROTATION (days run in order, whatever the weekday). Every day may carry its
-- own name. Existing routines stay WEEKLY with their weekdays unchanged.
-- CreateEnum
CREATE TYPE "RoutineScheduleMode" AS ENUM ('WEEKLY', 'ROTATION');

-- AlterTable
ALTER TABLE "Routine" ADD COLUMN "scheduleMode" "RoutineScheduleMode" NOT NULL DEFAULT 'WEEKLY';

-- AlterTable: rotation days have no weekday. The unique (routineId,
-- dayOfWeek) index still keeps weekly weekdays distinct; NULLs never collide.
ALTER TABLE "RoutineDay" ADD COLUMN "name" VARCHAR(40),
ALTER COLUMN "dayOfWeek" DROP NOT NULL;
