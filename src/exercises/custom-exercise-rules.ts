import {
  CUSTOM_EXERCISE_PROBLEM_MESSAGES,
  customExerciseProblem,
  exerciseNameKey,
  normalizeExerciseName,
  primaryEquipment,
  type CustomExerciseInput,
  type UpdateCustomExerciseRequest,
} from '@sunsteel/contracts';

/** EXER-06: a stored custom exercise, as far as a write needs it. */
export interface StoredCustomExercise {
  name: string;
  primaryMuscles: CustomExerciseInput['primaryMuscles'];
  secondaryMuscles: CustomExerciseInput['secondaryMuscles'];
  equipmentRequired: string[];
  movementPattern: CustomExerciseInput['movementPattern'];
  mechanic: CustomExerciseInput['mechanic'];
  note: string | null;
}

const unique = <T>(items: readonly T[]) => [...new Set(items)];

/** A patch applied over what is stored; an omitted field keeps its value. */
export function mergeCustomExercise(
  stored: StoredCustomExercise,
  patch: UpdateCustomExerciseRequest,
): CustomExerciseInput {
  return {
    name: patch.name ?? stored.name,
    primaryMuscles: patch.primaryMuscles ?? stored.primaryMuscles,
    secondaryMuscles: patch.secondaryMuscles ?? stored.secondaryMuscles,
    equipmentRequired:
      patch.equipmentRequired ??
      (stored.equipmentRequired as CustomExerciseInput['equipmentRequired']),
    movementPattern:
      patch.movementPattern === undefined
        ? stored.movementPattern
        : patch.movementPattern,
    mechanic: patch.mechanic === undefined ? stored.mechanic : patch.mechanic,
    note: patch.note === undefined ? stored.note : patch.note,
  };
}

/** The first rule the input breaks, as the message the client shows, or null. */
export function customExerciseRefusal(input: CustomExerciseInput): string | null {
  const problem = customExerciseProblem(input);
  return problem ? CUSTOM_EXERCISE_PROBLEM_MESSAGES[problem] : null;
}

/** The columns a valid input is stored as: name normalized, lists deduplicated. */
export function customExerciseData(input: CustomExerciseInput) {
  const note = (input.note ?? '').trim();
  const equipmentRequired = unique(input.equipmentRequired);
  return {
    name: normalizeExerciseName(input.name),
    primaryMuscles: unique(input.primaryMuscles),
    secondaryMuscles: unique(input.secondaryMuscles),
    equipmentRequired,
    equipment: primaryEquipment(equipmentRequired),
    movementPattern: input.movementPattern,
    mechanic: input.mechanic,
    note: note === '' ? null : note,
  };
}

/** Whether a name collides with any of the given names (case and spacing ignored). */
export function isNameTaken(name: string, existing: readonly string[]): boolean {
  const key = exerciseNameKey(name);
  return existing.some((other) => exerciseNameKey(other) === key);
}
