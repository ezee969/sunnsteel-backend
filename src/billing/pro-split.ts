import { readLinearState } from '../routines/linear-periodization';

/**
 * BILL-02: the Pro split's rules that a route guard cannot express, pure so
 * every downgrade rule is tested without a database. The owner's rule for all
 * of them: a downgrade never deletes or rewrites data -- what was made under
 * Pro is kept, running plans finish, and only new use stops.
 */

/**
 * Weeks of muscle history (PROG-03, PROG-04). A request past the plan's limit
 * is refused; an omitted one takes the default, capped at the limit, so a Free
 * member's default read never needs Pro.
 */
export function historyWeeks(
  requested: number | undefined,
  defaultWeeks: number,
  limit: number | null,
): { weeks: number; overLimit: boolean } {
  if (requested === undefined) {
    return {
      weeks: limit === null ? defaultWeeks : Math.min(defaultWeeks, limit),
      overLimit: false,
    };
  }
  return { weeks: requested, overLimit: limit !== null && requested > limit };
}

/**
 * Goals past the plan's limit (PROG-08), in stored order: kept and paused,
 * never deleted -- the first `limit` stay evaluated.
 */
export function pausedGoalIds(
  goalIds: readonly string[],
  limit: number | null,
): Set<string> {
  return new Set(limit === null ? [] : goalIds.slice(limit));
}

interface LinearExerciseLike {
  exerciseId: string;
  progressionScheme?: string | null;
  linearPeriodization?: unknown;
}

function linearBlockKey(exercise: LinearExerciseLike): string | null {
  const state = readLinearState(exercise.linearPeriodization);
  return state ? `${exercise.exerciseId}|${JSON.stringify(state)}` : null;
}

/**
 * Whether a routine write starts an 8-week block (ROUT-17 to ROUT-20): a
 * block state it carries that the routine does not already hold for the same
 * exercise. A running block travels with every edit unchanged, so an edit that
 * keeps it is not new -- a running block finishes after a downgrade -- while a
 * new reference max, another week or a block on another exercise is.
 */
export function startsLinearBlock(
  requested: readonly LinearExerciseLike[],
  stored: readonly LinearExerciseLike[],
): boolean {
  const held = new Set(stored.flatMap((exercise) => linearBlockKey(exercise) ?? []));
  return requested.some((exercise) => {
    if (exercise.progressionScheme !== 'LINEAR_PERIODIZATION') return false;
    const key = linearBlockKey(exercise);
    return key !== null && !held.has(key);
  });
}

/** The measurements beyond weight (PROG-12), which Free keeps read-only. */
export const PRO_BODY_FIELDS = [
  'waistCm',
  'hipsCm',
  'chestCm',
  'armCm',
  'thighCm',
  'bodyFatPercent',
] as const;
export type ProBodyField = (typeof PRO_BODY_FIELDS)[number];

/**
 * Whether a body-measurement write leaves every measurement beyond weight as
 * it is stored. A Free member logs and edits weight; the rest of the history
 * is kept read-only, so a write may neither add one nor clear one.
 */
export function keepsProBodyFields(
  requested: Partial<Record<ProBodyField, number | null | undefined>>,
  stored: Partial<Record<ProBodyField, number | null>> | null,
): boolean {
  return PRO_BODY_FIELDS.every(
    (field) => (requested[field] ?? null) === (stored?.[field] ?? null),
  );
}
