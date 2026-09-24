import { resolveRoutinePlan } from '@sunsteel/contracts';
import type { PlanBlock, PlanOverride } from '../../routines/routine-plan';

/**
 * NOTIF-04: which routines an account is planned to train on one local date.
 *
 * This is the schedule rule the frontend's `buildScheduleWeek` applies, ported
 * to the server because a reminder is sent while nobody has the app open. It is
 * deliberately the narrow half: it answers "is this date a training day", not
 * "what does the week look like", and it never invents an hour — the product
 * stores weekdays, so a reminder is a time the owner picked, not a countdown to
 * a session the schedule cannot time.
 */

export interface ReminderRoutineDay {
  /** Null on a rotation day. */
  dayOfWeek: number | null;
}

export interface ReminderRoutine {
  id: string;
  name: string;
  scheduleMode: 'WEEKLY' | 'ROTATION';
  /** Archived routines plan nothing, exactly as the Schedule page shows. */
  isCompleted: boolean;
  createdAt: Date;
  days: ReminderRoutineDay[];
  restDays: number[];
  rotationWeekdays: number[];
  /**
   * ROUT-15: current training blocks. While one covers the date, its own
   * schedule decides, through the same resolver the frontend schedule uses.
   */
  trainingBlocks?: PlanBlock[];
  /** ROUT-16: deloads, which win over the plan they lighten. */
  temporaryOverrides?: PlanOverride[];
}

export interface ReminderOverride {
  routineId: string;
  kind: 'MOVE' | 'SKIP';
  /** The planned date the override acts on. */
  date: string;
  /** Where a move sends it; null for a skip. */
  toDate: string | null;
}

export interface PlannedTrainingInput {
  /** The local calendar date being asked about, `YYYY-MM-DD`. */
  date: string;
  routines: ReminderRoutine[];
  overrides: ReminderOverride[];
  /** Routine ids with a session already started or finished on that date. */
  routineIdsTrainedOnDate: string[];
}

/** Monday is 1 and Sunday is 0, matching `Date.getUTCDay` and `dayOfWeek`. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const isOnOrAfterCreation = (routine: ReminderRoutine, date: string) =>
  date >= routine.createdAt.toISOString().slice(0, 10);

/**
 * The routines planned for the date, in the order they were given, excluding
 * any already trained that day. An empty result means no reminder is owed.
 */
export function routinesPlannedOn({
  date,
  routines,
  overrides,
  routineIdsTrainedOnDate,
}: PlannedTrainingInput): string[] {
  const weekday = weekdayOf(date);
  const trained = new Set(routineIdsTrainedOnDate);
  const planned: string[] = [];

  for (const routine of routines) {
    if (routine.isCompleted) continue;
    if (trained.has(routine.id)) continue;
    if (!isOnOrAfterCreation(routine, date)) continue;

    const routineOverrides = overrides.filter(
      (o) => o.routineId === routine.id,
    );
    // A workout moved onto this date counts even when the weekday does not,
    // and it is checked first so it survives a rest day on the target.
    const movedHere = routineOverrides.some(
      (o) => o.kind === 'MOVE' && o.toDate === date,
    );
    // Moving a day's workout away, or skipping it, empties the date.
    const movedAway = routineOverrides.some(
      (o) => o.kind === 'MOVE' && o.date === date && o.toDate !== date,
    );
    const skipped = routineOverrides.some(
      (o) => o.kind === 'SKIP' && o.date === date,
    );

    if (movedHere) {
      planned.push(routine.name);
      continue;
    }
    if (movedAway || skipped) continue;

    const plan = resolveRoutinePlan(routine, date);
    if (plan.scheduleMode === 'WEEKLY') {
      // A rest day is a plan not to train, never an unlogged workout.
      if (plan.restDays.includes(weekday)) continue;
      if (plan.days.some((day) => day.dayOfWeek === weekday)) {
        planned.push(routine.name);
      }
      continue;
    }

    // A rotation without training weekdays has no dates at all — the Schedule
    // page shows its next day as an undated note, so there is nothing to
    // remind about and guessing a date would be an invention.
    if (plan.rotationWeekdays.includes(weekday)) {
      planned.push(routine.name);
    }
  }

  return planned;
}

/** "Upper / Lower and Push Day" — a list a notification body can carry. */
export function describePlannedRoutines(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
