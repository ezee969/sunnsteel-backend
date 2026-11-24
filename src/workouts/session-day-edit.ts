import { BadRequestException } from "@nestjs/common";
import {
  apiError,
  EXERCISE_GROUP_MAX,
  hasOversizedGroup,
  matchSetRefusal,
  normalizeExerciseLinks,
  removeExerciseLinks,
  reorderExerciseLinks,
  setKindOf,
  type ApiErrorCode,
  type SessionDayEditResponse,
  type WorkoutSessionSnapshotV1,
} from "@sunsteel/contracts";

type SnapshotExercise =
  WorkoutSessionSnapshotV1["routineDay"]["exercises"][number];

/**
 * LIVE-25: the day's exercises in the order asked for -- every one named once
 * -- renumbered, with a superset or circuit link kept only while its pair
 * stays side by side. A reorder never changes a slot's identity.
 *
 * LIVE-29: with `links`, each exercise takes the link given at its new place
 * instead -- a group kept through a move inside it, or left on purpose --
 * the last never linking and no group passing `EXERCISE_GROUP_MAX`.
 */
export function reorderedDay(
  exercises: readonly SnapshotExercise[],
  orderedIds: readonly string[],
  links?: readonly boolean[],
): SnapshotExercise[] {
  const known = new Set(exercises.map((exercise) => exercise.id));
  if (
    orderedIds.length !== exercises.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !known.has(id)) ||
    (links !== undefined && links.length !== orderedIds.length)
  )
    throw new BadRequestException(apiError("DAY_EDIT_ORDER_MISMATCH"));
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const ordered = links
    ? normalizeExerciseLinks(
        orderedIds.map((id, index) => ({
          ...byId.get(id)!,
          linkedToNext: links[index],
        })),
      )
    : reorderExerciseLinks(exercises, orderedIds);
  if (hasOversizedGroup(ordered))
    throw new BadRequestException(
      apiError("EXERCISE_GROUP_TOO_LARGE", { max: EXERCISE_GROUP_MAX }),
    );
  return ordered.map((exercise, order) => ({ ...exercise, order }));
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

type PrescribedSet = SnapshotExercise["sets"][number];

/**
 * LIVE-27: the slot's prescription once `setNumber` is removed, renumbered
 * 1, 2, 3..., or why it cannot be. A done set is never removed (its work
 * counts), an exercise keeps one set, an 8-week block's working sets are its
 * block's, and a match set never loses the working set it follows.
 */
export function plannedSetRemoval(
  sets: readonly PrescribedSet[],
  setNumber: number,
  facts: { done: boolean; linearBlock: boolean },
): { sets: PrescribedSet[] } | { refusal: ApiErrorCode } {
  const ordered = [...sets].sort((a, b) => a.setNumber - b.setNumber);
  const target = ordered.find((set) => set.setNumber === setNumber);
  if (!target) return { refusal: "SET_REMOVE_NOT_PRESCRIBED" };
  if (facts.done) return { refusal: "SET_REMOVE_DONE" };
  if (ordered.length === 1) return { refusal: "SET_REMOVE_LAST" };
  if (facts.linearBlock && setKindOf(target) !== "WARMUP")
    return { refusal: "SET_REMOVE_LINEAR_BLOCK" };
  const remaining = ordered
    .filter((set) => set !== target)
    .map((set, index) => ({ ...set, setNumber: index + 1 }));
  if (matchSetRefusal(remaining, false))
    return { refusal: "MATCH_SET_PLACEMENT" };
  return { sets: remaining };
}

/**
 * LIVE-28: the day once `routineExerciseId` is removed, renumbered, its links
 * as the builder leaves them (a member leaving the middle of a group bridges
 * it), or why it cannot be: a day keeps at least one exercise -- the member
 * swaps it instead (LIVE-11).
 */
export function plannedExerciseRemoval(
  exercises: readonly SnapshotExercise[],
  routineExerciseId: string,
): { exercises: SnapshotExercise[] } | { refusal: ApiErrorCode } {
  const ordered = [...exercises].sort((a, b) => a.order - b.order);
  if (!ordered.some((exercise) => exercise.id === routineExerciseId))
    return { refusal: "SESSION_EXERCISE_NOT_FOUND" };
  if (ordered.length === 1) return { refusal: "DAY_EDIT_LAST_EXERCISE" };
  return {
    exercises: removeExerciseLinks(ordered, routineExerciseId).map(
      (exercise, order) => ({ ...exercise, order }),
    ),
  };
}
