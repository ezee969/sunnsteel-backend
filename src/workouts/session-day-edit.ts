import { BadRequestException } from "@nestjs/common";
import {
  apiError,
  reorderExerciseLinks,
  type SessionDayEditResponse,
  type WorkoutSessionSnapshotV1,
} from "@sunsteel/contracts";

type SnapshotExercise =
  WorkoutSessionSnapshotV1["routineDay"]["exercises"][number];

/**
 * LIVE-25: the day's exercises in the order asked for -- every one named once
 * -- renumbered, with a superset or circuit link kept only while its pair
 * stays side by side. A reorder never changes a slot's identity.
 */
export function reorderedDay(
  exercises: readonly SnapshotExercise[],
  orderedIds: readonly string[],
): SnapshotExercise[] {
  const known = new Set(exercises.map((exercise) => exercise.id));
  if (
    orderedIds.length !== exercises.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !known.has(id))
  )
    throw new BadRequestException(apiError("DAY_EDIT_ORDER_MISMATCH"));
  return reorderExerciseLinks(exercises, orderedIds).map((exercise, order) => ({
    ...exercise,
    order,
  }));
}

/** The plan a day change is written to: the working copy in force, if any. */
export function dayEditPlan(session: {
  trainingBlockId: string | null;
  temporaryOverrideId: string | null;
}): SessionDayEditResponse["plan"] {
  if (session.temporaryOverrideId) return "DELOAD";
  if (session.trainingBlockId) return "TRAINING_BLOCK";
  return "ROUTINE";
}

/** The set numbers of an added exercise run 1, 2, 3... with no gap. */
export function assertSetNumbers(sets: ReadonlyArray<{ setNumber: number }>) {
  const numbers = sets.map((set) => set.setNumber).sort((a, b) => a - b);
  if (numbers.some((number, index) => number !== index + 1))
    throw new BadRequestException("Set numbers must run 1, 2, 3 with no gap");
}
