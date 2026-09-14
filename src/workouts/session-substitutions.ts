import type {
  SessionExerciseSubstitution,
  WorkoutSessionSnapshotV1,
} from '@sunsteel/contracts';

/**
 * LIVE-11: exercises performed in place of routine slots for one session.
 *
 * `WorkoutSession.exerciseSubstitutions` holds them as JSON beside the
 * immutable snapshot. Every reader that attributes a set to an exercise
 * (muscle rollups, records, session comparison, the session response)
 * resolves a slot through `performedExercise` so a swap is never credited
 * to the prescribed exercise.
 */

type SnapshotSlot = WorkoutSessionSnapshotV1['routineDay']['exercises'][number];
export type PerformedExercise = SnapshotSlot['exercise'];

const isSubstitution = (
  value: unknown,
): value is SessionExerciseSubstitution => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SessionExerciseSubstitution>;
  return (
    typeof item.routineExerciseId === 'string' &&
    typeof item.exercise?.id === 'string' &&
    typeof item.exercise.name === 'string' &&
    Array.isArray(item.exercise.primaryMuscles)
  );
};

/** Parse the JSON column; malformed entries are ignored rather than thrown. */
export function readSubstitutions(
  value: unknown,
): SessionExerciseSubstitution[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSubstitution).map((substitution) => ({
    routineExerciseId: substitution.routineExerciseId,
    exercise: {
      id: substitution.exercise.id,
      name: substitution.exercise.name,
      primaryMuscles: substitution.exercise.primaryMuscles,
      secondaryMuscles: Array.isArray(substitution.exercise.secondaryMuscles)
        ? substitution.exercise.secondaryMuscles
        : [],
    },
    substitutedAt: substitution.substitutedAt,
  }));
}

export function substitutionFor(
  substitutions: SessionExerciseSubstitution[],
  routineExerciseId: string,
): SessionExerciseSubstitution | undefined {
  return substitutions.find(
    (substitution) => substitution.routineExerciseId === routineExerciseId,
  );
}

/** The exercise a slot was performed with: the substitute when one was chosen. */
export function performedExercise(
  slot: SnapshotSlot,
  substitutions: SessionExerciseSubstitution[],
): PerformedExercise {
  return substitutionFor(substitutions, slot.id)?.exercise ?? slot.exercise;
}

/** The exercise a set log for this slot must name. */
export function expectedExerciseId(
  routineExercise: { id: string; exerciseId: string },
  substitutions: SessionExerciseSubstitution[],
): string {
  return (
    substitutionFor(substitutions, routineExercise.id)?.exercise.id ??
    routineExercise.exerciseId
  );
}

export function withoutSubstitution(
  substitutions: SessionExerciseSubstitution[],
  routineExerciseId: string,
): SessionExerciseSubstitution[] {
  return substitutions.filter(
    (substitution) => substitution.routineExerciseId !== routineExerciseId,
  );
}

export function withSubstitution(
  substitutions: SessionExerciseSubstitution[],
  next: SessionExerciseSubstitution,
): SessionExerciseSubstitution[] {
  return [...withoutSubstitution(substitutions, next.routineExerciseId), next];
}

/**
 * Progression advances the prescribed exercise. A substituted slot was done
 * with something else, so its sets never move that prescription.
 */
export function excludeSubstitutedSlots<T extends { routineExerciseId: string }>(
  logs: T[],
  substitutions: SessionExerciseSubstitution[],
): T[] {
  const substituted = new Set(
    substitutions.map((substitution) => substitution.routineExerciseId),
  );
  return logs.filter((log) => !substituted.has(log.routineExerciseId));
}
