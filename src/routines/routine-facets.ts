import {
  ROUTINE_DURATION_BAND_MAX_MINUTES,
  type ExerciseEquipment,
  type MuscleGroup,
  type RoutineDurationBand,
  type RoutineFacets,
  type RoutineSet,
} from '@sunsteel/contracts';

/**
 * ROUT-07. What a routine programs, derived from the routine itself.
 *
 * These four facets are **never stored**: a denormalised facet drifts from
 * the routine the moment an edit misses its recompute, and a discovery filter
 * that quietly disagrees with the routine it points at is worse than no
 * filter. They are cheap to compute from rows the read already loads.
 *
 * The duration rule is `ROUT-10`'s `estimateDaySeconds`, ported here the way
 * `NOTIF-04` ported the schedule rule to the server, with the same constants
 * so the wizard and discovery can never quote different numbers.
 */

/** ROUT-10's constants. Changing one changes both surfaces, deliberately. */
export const SECONDS_PER_REP = 4;
export const SETUP_SECONDS_PER_EXERCISE = 60;

export interface FacetExercise {
  restSeconds: number;
  sets: Pick<RoutineSet, 'repType' | 'reps' | 'minReps' | 'maxReps'>[];
  exercise: {
    primaryMuscles: MuscleGroup[];
    secondaryMuscles: MuscleGroup[];
    equipmentRequired: string[];
  };
}

export interface FacetDay {
  exercises: FacetExercise[];
}

/** The reps a set is planned for; a range is judged by its top end. */
export function setReps(
  set: Pick<RoutineSet, 'repType' | 'reps' | 'minReps' | 'maxReps'>,
): number {
  if (set.repType === 'RANGE') return set.maxReps ?? set.minReps ?? 0;
  return set.reps ?? 0;
}

/** ROUT-10's estimate: work plus rest plus a fixed setup per exercise. */
export function estimateDaySeconds(day: FacetDay): number {
  let seconds = day.exercises.length * SETUP_SECONDS_PER_EXERCISE;
  for (const exercise of day.exercises) {
    for (const set of exercise.sets) {
      seconds += setReps(set) * SECONDS_PER_REP;
      seconds += exercise.restSeconds;
    }
  }
  return seconds;
}

export function deriveRoutineFacets(days: FacetDay[]): RoutineFacets {
  const muscles = new Set<MuscleGroup>();
  const equipment = new Set<string>();
  let exerciseCount = 0;
  let longestDaySeconds = 0;

  for (const day of days) {
    exerciseCount += day.exercises.length;
    longestDaySeconds = Math.max(longestDaySeconds, estimateDaySeconds(day));
    for (const { exercise } of day.exercises) {
      for (const muscle of exercise.primaryMuscles) muscles.add(muscle);
      // Secondary muscles count: a routine that trains a muscle only as a
      // secondary mover still trains it, and hiding that would make the
      // filter answer a narrower question than it asks.
      for (const muscle of exercise.secondaryMuscles) muscles.add(muscle);
      for (const item of exercise.equipmentRequired) equipment.add(item);
    }
  }

  return {
    dayCount: days.length,
    exerciseCount,
    muscles: [...muscles].sort(),
    equipment: [...equipment].sort() as ExerciseEquipment[],
    longestDayMinutes: Math.round(longestDaySeconds / 60),
  };
}

/** Which band a routine's longest day falls in. */
export function durationBand(longestDayMinutes: number): RoutineDurationBand {
  if (longestDayMinutes <= ROUTINE_DURATION_BAND_MAX_MINUTES.SHORT) {
    return 'SHORT';
  }
  if (longestDayMinutes <= ROUTINE_DURATION_BAND_MAX_MINUTES.MEDIUM) {
    return 'MEDIUM';
  }
  return 'LONG';
}

/**
 * Whether one routine answers a viewer's filters. Equipment is the one that
 * reads backwards: selecting equipment says what the viewer **has**, so a
 * routine matches when it needs nothing outside that set. Bodyweight work
 * lists no equipment and therefore always matches.
 */
export function matchesDiscoveryFilters(
  candidate: RoutineFacets & {
    name: string;
    description: string | null;
    goal: string | null;
    experienceLevel: string | null;
  },
  filters: {
    q?: string;
    goal?: string;
    experienceLevel?: string;
    days?: number;
    muscle?: string;
    equipment?: string[];
    duration?: RoutineDurationBand;
  },
): boolean {
  if (filters.q) {
    const needle = filters.q.trim().toLowerCase();
    const haystack =
      `${candidate.name} ${candidate.description ?? ''}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  // An undeclared goal is unknown, not a wildcard: a routine whose author
  // said nothing must not be returned as though they had said this.
  if (filters.goal && candidate.goal !== filters.goal) return false;
  if (
    filters.experienceLevel &&
    candidate.experienceLevel !== filters.experienceLevel
  ) {
    return false;
  }
  if (typeof filters.days === 'number' && candidate.dayCount !== filters.days) {
    return false;
  }
  if (filters.muscle && !candidate.muscles.includes(filters.muscle as MuscleGroup)) {
    return false;
  }
  if (filters.equipment?.length) {
    const available = new Set(filters.equipment);
    if (candidate.equipment.some((item) => !available.has(item))) return false;
  }
  if (
    filters.duration &&
    durationBand(candidate.longestDayMinutes) !== filters.duration
  ) {
    return false;
  }
  return true;
}
