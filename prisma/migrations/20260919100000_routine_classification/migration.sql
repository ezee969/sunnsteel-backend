-- ROUT-07: owner-declared goal and experience level on a routine.
-- Both stay NULL on every existing routine: undeclared is a real state, and
-- backfilling a default would put a claim in the author's mouth.
ALTER TABLE "Routine"
  ADD COLUMN "goal" "TrainingGoal",
  ADD COLUMN "experienceLevel" "TrainingExperienceLevel";

-- Discovery filters on these, so the common case is worth an index.
CREATE INDEX "Routine_goal_idx" ON "Routine"("goal");
CREATE INDEX "Routine_experienceLevel_idx" ON "Routine"("experienceLevel");
