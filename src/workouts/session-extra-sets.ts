import { setKindOf, type SetKind } from '@sunsteel/contracts';

import { readSnapshot } from './analytics/session-snapshot';

/**
 * LIVE-15: a slot's prescribed sets are the ones in the session snapshot.
 * A set above them is extra work done today -- it counts wherever completed
 * work counts, but progression walks the snapshot and never sees it.
 *
 * Extras are appended one after another, never with a gap, so previous
 * performance and session comparisons keep matching by set number; for the
 * same reason only the last one can be taken back.
 */
export const MAX_EXTRA_SETS = 10;

type NumberedSet = { setNumber: number };

const highest = (sets: NumberedSet[]) =>
  sets.reduce((max, set) => Math.max(max, set.setNumber), 0);

/**
 * The highest prescribed set number of a slot. Sessions started before the
 * snapshot was captured, or slots it does not hold, fall back to the live
 * routine's sets.
 */
export function prescribedSetCount(
  snapshotPayload: unknown,
  routineExerciseId: string,
  liveSets: NumberedSet[],
): number {
  if (snapshotPayload) {
    const slot = readSnapshot(snapshotPayload).routineDay.exercises.find(
      (exercise) => exercise.id === routineExerciseId,
    );
    if (slot) return highest(slot.sets);
  }
  return highest(liveSets);
}

/**
 * LIVE-12: the kind a new set log starts with -- its prescription's, from the
 * snapshot when there is one; an extra set is a working set.
 */
export function prescribedSetKind(
  snapshotPayload: unknown,
  routineExerciseId: string,
  setNumber: number,
  liveSets: Array<NumberedSet & { kind?: SetKind }>,
): SetKind {
  if (snapshotPayload) {
    const slot = readSnapshot(snapshotPayload).routineDay.exercises.find(
      (exercise) => exercise.id === routineExerciseId,
    );
    if (slot)
      return setKindOf(slot.sets.find((set) => set.setNumber === setNumber));
  }
  return setKindOf(liveSets.find((set) => set.setNumber === setNumber));
}

/** Why a new set log above the prescription is refused, or null. */
export function extraSetRefusal(
  setNumber: number,
  prescribed: number,
  highestLogged: number,
): string | null {
  if (setNumber <= prescribed) return null;
  if (setNumber > prescribed + MAX_EXTRA_SETS)
    return `An exercise can take at most ${MAX_EXTRA_SETS} extra sets`;
  if (setNumber !== Math.max(prescribed, highestLogged) + 1)
    return 'Extra sets are added after the last set';
  return null;
}

/** Why a set log cannot be removed from an active session, or null. */
export function removeSetRefusal(
  setNumber: number,
  prescribed: number,
  highestLogged: number,
): string | null {
  if (setNumber <= prescribed) return 'A prescribed set cannot be removed';
  if (setNumber !== highestLogged)
    return 'Only the last added set can be removed';
  return null;
}
