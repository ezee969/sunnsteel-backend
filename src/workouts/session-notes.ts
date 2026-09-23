import { BadRequestException } from '@nestjs/common';
import {
  SESSION_EXERCISE_NOTE_MAX_LENGTH,
  SESSION_NOTE_MAX_LENGTH,
  type SessionExerciseNote,
  type SessionExerciseSubstitution,
  type SessionRecapExerciseNote,
  type UpdateSessionNotesRequest,
  type WorkoutSessionSnapshotV1,
} from '@sunsteel/contracts';
import { performedExercise } from './session-substitutions';

/**
 * LIVE-16. Notes are what the owner wrote about this workout: one for the
 * whole of it and at most one per exercise slot. They live on the session and
 * never reach the routine, whose own exercise note is the standing
 * instruction. Pure, so each rule is tested on its own.
 */

/** Parse the JSON column; malformed entries are ignored rather than thrown. */
export function readExerciseNotes(value: unknown): SessionExerciseNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    item &&
    typeof item === 'object' &&
    typeof (item as SessionExerciseNote).routineExerciseId === 'string' &&
    typeof (item as SessionExerciseNote).note === 'string'
      ? [
          {
            routineExerciseId: (item as SessionExerciseNote).routineExerciseId,
            note: (item as SessionExerciseNote).note,
          },
        ]
      : [],
  );
}

/**
 * Trimmed, or null when empty. Too long is refused rather than cut, because a
 * note clipped mid-sentence would say something its author did not write.
 */
export function normalizeNote(
  value: string | null | undefined,
  max: number,
  what: string,
): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length > max)
    throw new BadRequestException(`${what} can be at most ${max} characters`);
  return trimmed === '' ? null : trimmed;
}

/**
 * The exercise notes after an update, in the day's slot order. Each update
 * replaces or clears one slot's note and leaves the others alone, so two
 * notes saved moments apart cannot overwrite each other.
 */
export function mergeExerciseNotes(
  current: SessionExerciseNote[],
  updates: NonNullable<UpdateSessionNotesRequest['exerciseNotes']>,
  slotOrder: string[],
): SessionExerciseNote[] {
  const slots = new Set(slotOrder);
  const byId = new Map(current.map((item) => [item.routineExerciseId, item.note]));
  const seen = new Set<string>();
  for (const update of updates) {
    if (!slots.has(update.routineExerciseId))
      throw new BadRequestException('Exercise is not part of this workout');
    if (seen.has(update.routineExerciseId))
      throw new BadRequestException('Each exercise can be noted once per request');
    seen.add(update.routineExerciseId);
    const note = normalizeNote(
      update.note,
      SESSION_EXERCISE_NOTE_MAX_LENGTH,
      'An exercise note',
    );
    if (note === null) byId.delete(update.routineExerciseId);
    else byId.set(update.routineExerciseId, note);
  }
  return slotOrder.flatMap((routineExerciseId) => {
    const note = byId.get(routineExerciseId);
    return note ? [{ routineExerciseId, note }] : [];
  });
}

export const normalizeSessionNote = (value: string | null | undefined) =>
  normalizeNote(value, SESSION_NOTE_MAX_LENGTH, 'A workout note');

/**
 * The recap names each noted exercise the way the workout did it: a swapped
 * slot by the substitute that was performed, in the day's order.
 */
export function recapExerciseNotes(
  notes: SessionExerciseNote[],
  slots: WorkoutSessionSnapshotV1['routineDay']['exercises'],
  substitutions: SessionExerciseSubstitution[],
): SessionRecapExerciseNote[] {
  const byId = new Map(notes.map((item) => [item.routineExerciseId, item.note]));
  return slots.flatMap((slot) => {
    const note = byId.get(slot.id);
    if (!note) return [];
    const exercise = performedExercise(slot, substitutions);
    return [{ routineExerciseId: slot.id, exerciseName: exercise.name, note }];
  });
}
