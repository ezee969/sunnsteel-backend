import {
  apiError,
  setKindOf,
  type ApiErrorBody,
  type LinearPeriodizationState,
  type LpLoggedSet,
  type SetKind,
} from "@sunsteel/contracts";

import { readLinearState } from "../routines/linear-periodization";
import { readSnapshot } from "./analytics/session-snapshot";

// ROUT-17: what a workout's snapshot says an LP slot prescribed. The
// snapshot froze the slot's block and its working sets' loads when the
// workout started, so the load a set is stored with and the step a finish
// advances are always this workout's, whatever the routine reads by then.

type Refusal = Pick<ApiErrorBody, "code" | "message" | "params">;

type SnapshotSet = {
  setNumber: number;
  weight?: number | null;
  kind?: SetKind | null;
};

export interface LinearSlot {
  state: LinearPeriodizationState;
  minWeightIncrement: number;
  /** The slot's sets in the snapshot, warm-ups included. */
  sets: SnapshotSet[];
}

/**
 * The slot's block as the workout started, or null when the slot is not on
 * an 8-week block, has no reference max yet, or the workout has no snapshot.
 */
export function linearSlotOf(
  snapshotPayload: unknown,
  routineExerciseId: string,
): LinearSlot | null {
  if (!snapshotPayload) return null;
  const slot = readSnapshot(snapshotPayload).routineDay.exercises.find(
    (exercise) => exercise.id === routineExerciseId,
  ) as
    | {
        progressionScheme?: string;
        minWeightIncrement?: number;
        linearPeriodization?: unknown;
        sets: SnapshotSet[];
      }
    | undefined;
  if (!slot || slot.progressionScheme !== "LINEAR_PERIODIZATION") return null;
  const state = readLinearState(slot.linearPeriodization);
  if (!state) return null;
  return {
    state,
    minWeightIncrement: slot.minWeightIncrement ?? 2.5,
    sets: slot.sets,
  };
}

const isWorking = (set: { kind?: SetKind | null }) =>
  setKindOf(set) !== "WARMUP";

/**
 * What a set-log write on an LP slot stores: the prescribed load of a
 * working set, whatever weight was sent; a warm-up keeps what was sent. An
 * extra set or a change of a working set's kind is refused.
 */
export function linearSetWrite(
  slot: LinearSlot,
  write: { setNumber: number; weight?: number; kind?: SetKind; isNew: boolean },
): { weight: number | undefined } | { refusal: Refusal } {
  const prescribed = slot.sets.find((set) => set.setNumber === write.setNumber);
  if (!prescribed) {
    return { refusal: apiError("LINEAR_BLOCK_EXTRA_SET") };
  }
  if (!isWorking(prescribed)) return { weight: write.weight };
  if (write.kind && write.kind !== setKindOf(prescribed)) {
    return { refusal: apiError("LINEAR_BLOCK_KIND_FIXED") };
  }
  return { weight: prescribed.weight ?? write.weight };
}

/**
 * The slot's working sets as a completed workout left them, numbered by
 * their place among the working sets (1-3), with the loads it prescribed.
 */
export function linearLoggedSets(
  slot: LinearSlot,
  logs: ReadonlyArray<{
    setNumber: number;
    reps: number | null;
    isCompleted: boolean;
  }>,
): LpLoggedSet[] {
  return slot.sets.filter(isWorking).map((set, index) => {
    const log = logs.find((entry) => entry.setNumber === set.setNumber);
    return {
      set: index + 1,
      reps: log?.reps ?? 0,
      loadKg: set.weight ?? 0,
      completed: Boolean(log?.isCompleted) && (log?.reps ?? 0) > 0,
    };
  });
}
