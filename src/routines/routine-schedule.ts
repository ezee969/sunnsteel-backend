import { BadRequestException } from '@nestjs/common';
import {
  ROUTINE_DAY_NAME_MAX,
  ROUTINE_DAYS_MAX,
  type RoutineScheduleMode,
} from '@sunsteel/contracts';

interface DayScheduleInput {
  dayOfWeek?: number | null;
  name?: string | null;
  order?: number;
}

/**
 * ROUT-11: checks and normalizes the days of a routine for its schedule mode.
 * WEEKLY days need distinct weekdays and keep their order; ROTATION days have
 * no weekday and are renumbered 0..n-1 in their given order, which is the
 * rotation. Names are trimmed, and a blank name is no name.
 */
export function normalizeRoutineDays<T extends DayScheduleInput>(
  mode: RoutineScheduleMode,
  days: readonly T[],
): Array<T & { dayOfWeek: number | null; name: string | null; order: number }> {
  if (days.length > ROUTINE_DAYS_MAX) {
    throw new BadRequestException(
      `A routine has at most ${ROUTINE_DAYS_MAX} days`,
    );
  }
  const named = days.map((day, index) => {
    const name = day.name?.trim() || null;
    if (name && name.length > ROUTINE_DAY_NAME_MAX) {
      throw new BadRequestException(
        `Day names have at most ${ROUTINE_DAY_NAME_MAX} characters`,
      );
    }
    return { day, name, order: day.order ?? index, index };
  });

  if (mode === 'ROTATION') {
    if (named.some(({ day }) => typeof day.dayOfWeek === 'number')) {
      throw new BadRequestException('Rotation days have no weekday');
    }
    return [...named]
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map(({ day, name }, order) => ({ ...day, dayOfWeek: null, name, order }));
  }

  const seen = new Set<number>();
  for (const { day } of named) {
    if (typeof day.dayOfWeek !== 'number') {
      throw new BadRequestException('Every weekly day needs a weekday');
    }
    if (seen.has(day.dayOfWeek)) {
      throw new BadRequestException('Each weekday can appear only once');
    }
    seen.add(day.dayOfWeek);
  }
  return named.map(({ day, name, order }) => ({
    ...day,
    dayOfWeek: day.dayOfWeek as number,
    name,
    order,
  }));
}

/** The routine's last completed session, as far as the rotation needs it. */
export interface LastRotationSession {
  routineDayId: string | null;
  /** The day's order when the session ran (from its snapshot). */
  order: number | null;
}

/**
 * The rotation day after the last completed session: the next by order after
 * that same day, or — when the day was since replaced by a routine edit — the
 * first with a later order than it had; wrapping to the first day, which is
 * also the answer before any completed session.
 */
export function nextRotationDayId(
  days: ReadonlyArray<{ id: string; order: number }>,
  last: LastRotationSession | null,
): string | null {
  if (days.length === 0) return null;
  const sorted = [...days].sort((a, b) => a.order - b.order);
  if (!last) return sorted[0].id;
  const index = last.routineDayId
    ? sorted.findIndex((day) => day.id === last.routineDayId)
    : -1;
  if (index >= 0) return sorted[(index + 1) % sorted.length].id;
  if (typeof last.order === 'number') {
    const lastOrder = last.order;
    return (sorted.find((day) => day.order > lastOrder) ?? sorted[0]).id;
  }
  return sorted[0].id;
}

/**
 * SCHED-07: a weekly routine's planned rest weekdays, sorted and unique.
 * Explicit rest days may not repeat a training weekday; kept ones (omitted
 * on update) silently drop any that became training weekdays. Rotations
 * have none.
 */
export function normalizeRestDays(
  mode: RoutineScheduleMode,
  days: ReadonlyArray<{ dayOfWeek: number | null }>,
  requested: readonly number[] | undefined,
  kept: readonly number[] = [],
): number[] {
  if (mode === 'ROTATION') {
    if (requested?.length) {
      throw new BadRequestException('Rotation routines have no rest days');
    }
    return [];
  }
  const training = new Set(days.map((day) => day.dayOfWeek));
  if (requested && requested.some((weekday) => training.has(weekday))) {
    throw new BadRequestException('A rest day cannot also be a training day');
  }
  const source = requested ?? kept.filter((weekday) => !training.has(weekday));
  return [...new Set(source)].sort((a, b) => a - b);
}
