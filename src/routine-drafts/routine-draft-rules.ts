import {
  ROUTINE_DAY_NAME_MAX,
  ROUTINE_DAYS_MAX,
  ROUTINE_DRAFT_DESCRIPTION_MAX,
  ROUTINE_DRAFT_EXERCISES_PER_DAY_MAX,
  ROUTINE_DRAFT_NAME_MAX,
  ROUTINE_DRAFT_REPS_MAX,
  ROUTINE_DRAFT_REPS_MIN,
  ROUTINE_DRAFT_REST_SECONDS_MAX,
  ROUTINE_DRAFT_REST_SECONDS_MIN,
  ROUTINE_DRAFT_SETS_PER_DAY_MAX,
  ROUTINE_DRAFT_SETS_PER_EXERCISE_MAX,
  ROUTINE_DRAFT_WEEKLY_MUSCLE_SETS_MAX,
  ROUTINE_SCHEDULE_MODES,
  type RoutineDraft,
  type RoutineDraftDay,
  type RoutineDraftExercise,
  type RoutineScheduleMode,
} from '@sunsteel/contracts';

/**
 * INTEL-03: the check every model answer passes before a member sees it, pure
 * so the evals run the same rules as production. The model's schema shapes an
 * answer; this decides whether it is a routine: real exercises, the plan's
 * structure and sane volume. It says what is wrong in words the one automatic
 * repair can act on.
 */

export interface DraftCatalogExercise {
  id: string;
  name: string;
  primaryMuscles: readonly string[];
  equipment: string;
  equipmentRequired: readonly string[];
  movementPattern: string | null;
}

export type DraftCheck =
  | { kind: 'DRAFT'; draft: RoutineDraft }
  | { kind: 'NOT_TRAINING' }
  | { kind: 'INVALID'; problems: string[] };

/** Dumbbell work steps by 2 kg; barbell, machine and cable by 2.5 kg, as templates do. */
function weightIncrement(equipment: string): number {
  return equipment === 'dumbbell' ? 2 : 2.5;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerWithin(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Checks one day's exercises, adding what it finds to `problems`. */
function readExercises(
  raw: unknown,
  label: string,
  byName: ReadonlyMap<string, DraftCatalogExercise>,
  problems: string[],
  muscleSets: Map<string, number>,
): RoutineDraftExercise[] {
  if (
    !Array.isArray(raw) ||
    raw.length < 1 ||
    raw.length > ROUTINE_DRAFT_EXERCISES_PER_DAY_MAX
  ) {
    problems.push(
      `${label} needs 1 to ${ROUTINE_DRAFT_EXERCISES_PER_DAY_MAX} exercises.`,
    );
    return [];
  }
  const exercises: RoutineDraftExercise[] = [];
  const seen = new Set<string>();
  let daySets = 0;
  for (const item of raw) {
    const entry = isRecord(item) ? item : {};
    const name = text(entry.exercise);
    const found = byName.get(name);
    if (!found) {
      problems.push(`${label}: "${name}" is not in the catalog.`);
      continue;
    }
    if (seen.has(name)) problems.push(`${label} lists "${name}" twice.`);
    seen.add(name);
    const { sets, minReps, maxReps, restSeconds } = entry;
    if (!integerWithin(sets, 1, ROUTINE_DRAFT_SETS_PER_EXERCISE_MAX)) {
      problems.push(
        `${label}: "${name}" needs 1 to ${ROUTINE_DRAFT_SETS_PER_EXERCISE_MAX} sets.`,
      );
      continue;
    }
    if (
      !integerWithin(minReps, ROUTINE_DRAFT_REPS_MIN, ROUTINE_DRAFT_REPS_MAX) ||
      !integerWithin(maxReps, ROUTINE_DRAFT_REPS_MIN, ROUTINE_DRAFT_REPS_MAX) ||
      minReps > maxReps
    ) {
      problems.push(
        `${label}: "${name}" needs a rep range within ${ROUTINE_DRAFT_REPS_MIN} to ${ROUTINE_DRAFT_REPS_MAX}.`,
      );
      continue;
    }
    if (
      !integerWithin(
        restSeconds,
        ROUTINE_DRAFT_REST_SECONDS_MIN,
        ROUTINE_DRAFT_REST_SECONDS_MAX,
      )
    ) {
      problems.push(
        `${label}: "${name}" needs ${ROUTINE_DRAFT_REST_SECONDS_MIN} to ${ROUTINE_DRAFT_REST_SECONDS_MAX} seconds of rest.`,
      );
      continue;
    }
    daySets += sets;
    for (const muscle of found.primaryMuscles) {
      muscleSets.set(muscle, (muscleSets.get(muscle) ?? 0) + sets);
    }
    exercises.push({
      exerciseId: found.id,
      sets,
      minReps,
      maxReps,
      restSeconds,
      minWeightIncrement: weightIncrement(found.equipment),
    });
  }
  if (daySets > ROUTINE_DRAFT_SETS_PER_DAY_MAX) {
    problems.push(
      `${label} has ${daySets} sets; the most is ${ROUTINE_DRAFT_SETS_PER_DAY_MAX}.`,
    );
  }
  return exercises;
}

function readDays(
  raw: unknown,
  mode: RoutineScheduleMode,
  byName: ReadonlyMap<string, DraftCatalogExercise>,
  problems: string[],
): RoutineDraftDay[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > ROUTINE_DAYS_MAX) {
    problems.push(`A routine needs 1 to ${ROUTINE_DAYS_MAX} days.`);
    return [];
  }
  const muscleSets = new Map<string, number>();
  const weekdays = new Set<number>();
  const days = raw.map((item, index): RoutineDraftDay => {
    const entry = isRecord(item) ? item : {};
    const label = `Day ${index + 1}`;
    const name = text(entry.name);
    if (!name || name.length > ROUTINE_DAY_NAME_MAX) {
      problems.push(`${label} needs a name of at most ${ROUTINE_DAY_NAME_MAX} characters.`);
    }
    let slot = index;
    if (mode === 'WEEKLY') {
      if (!integerWithin(entry.weekday, 0, 6) || weekdays.has(entry.weekday)) {
        problems.push(`${label} needs its own weekday from 0 (Sunday) to 6 (Saturday).`);
      } else {
        weekdays.add(entry.weekday);
        slot = entry.weekday;
      }
    }
    return {
      slot,
      name,
      exercises: readExercises(entry.exercises, label, byName, problems, muscleSets),
    };
  });
  for (const [muscle, sets] of muscleSets) {
    if (sets > ROUTINE_DRAFT_WEEKLY_MUSCLE_SETS_MAX) {
      problems.push(
        `${muscle} gets ${sets} direct sets across the plan; the most is ${ROUTINE_DRAFT_WEEKLY_MUSCLE_SETS_MAX}.`,
      );
    }
  }
  return days.sort((a, b) => a.slot - b.slot);
}

/**
 * Reads a model's answer against the catalog. `null` is an answer that never
 * arrived whole.
 */
export function checkDraftAnswer(
  answer: unknown,
  catalog: readonly DraftCatalogExercise[],
): DraftCheck {
  if (!isRecord(answer)) {
    return { kind: 'INVALID', problems: ['The answer was incomplete.'] };
  }
  if (answer.status === 'NOT_TRAINING') return { kind: 'NOT_TRAINING' };
  const raw = answer.draft;
  if (answer.status !== 'DRAFT' || !isRecord(raw)) {
    return { kind: 'INVALID', problems: ['The answer has no draft.'] };
  }

  const problems: string[] = [];
  const name = text(raw.name);
  if (!name || name.length > ROUTINE_DRAFT_NAME_MAX) {
    problems.push(`The name must be 1 to ${ROUTINE_DRAFT_NAME_MAX} characters.`);
  }
  const description = text(raw.description);
  if (description.length > ROUTINE_DRAFT_DESCRIPTION_MAX) {
    problems.push(`The description must be at most ${ROUTINE_DRAFT_DESCRIPTION_MAX} characters.`);
  }
  const mode = raw.scheduleMode as RoutineScheduleMode;
  if (!ROUTINE_SCHEDULE_MODES.includes(mode)) {
    return { kind: 'INVALID', problems: [...problems, 'scheduleMode must be WEEKLY or ROTATION.'] };
  }
  const byName = new Map(catalog.map((exercise) => [exercise.name, exercise]));
  const days = readDays(raw.days, mode, byName, problems);
  if (problems.length) return { kind: 'INVALID', problems };
  return { kind: 'DRAFT', draft: { name, description, scheduleMode: mode, days } };
}
