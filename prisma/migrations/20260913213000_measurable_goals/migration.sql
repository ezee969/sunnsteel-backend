CREATE TYPE "MeasurableGoalType" AS ENUM (
  'WEEKLY_SESSIONS',
  'WEEKLY_VOLUME',
  'STREAK_DAYS',
  'EXERCISE_ESTIMATED_1RM',
  'BODY_WEIGHT'
);

CREATE TYPE "MeasurableGoalDirection" AS ENUM ('AT_LEAST', 'AT_MOST');

CREATE TABLE "MeasurableGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "MeasurableGoalType" NOT NULL,
  "targetValue" DOUBLE PRECISION NOT NULL,
  "direction" "MeasurableGoalDirection" NOT NULL DEFAULT 'AT_LEAST',
  "exerciseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeasurableGoal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "measurable_goal_positive_target" CHECK ("targetValue" > 0),
  CONSTRAINT "measurable_goal_exercise_shape" CHECK (
    ("type" = 'EXERCISE_ESTIMATED_1RM') = ("exerciseId" IS NOT NULL)
  ),
  CONSTRAINT "measurable_goal_direction_shape" CHECK (
    "type" = 'BODY_WEIGHT' OR "direction" = 'AT_LEAST'
  )
);

CREATE INDEX "MeasurableGoal_userId_createdAt_idx"
  ON "MeasurableGoal"("userId", "createdAt");
CREATE INDEX "MeasurableGoal_exerciseId_idx"
  ON "MeasurableGoal"("exerciseId");
CREATE UNIQUE INDEX "measurable_goal_user_kind_without_exercise"
  ON "MeasurableGoal"("userId", "type")
  WHERE "exerciseId" IS NULL;
CREATE UNIQUE INDEX "measurable_goal_user_kind_exercise"
  ON "MeasurableGoal"("userId", "type", "exerciseId")
  WHERE "exerciseId" IS NOT NULL;

ALTER TABLE "MeasurableGoal"
  ADD CONSTRAINT "MeasurableGoal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MeasurableGoal"
  ADD CONSTRAINT "MeasurableGoal_exerciseId_fkey"
  FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
