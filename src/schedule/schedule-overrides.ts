import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  SCHEDULE_MOVE_MAX_DAYS,
  SCHEDULE_OVERRIDES_MAX_RANGE_DAYS,
  SCHEDULE_SKIP_PAST_DAYS,
  type RoutineScheduleMode,
  type ScheduleOverrideKind,
} from '@sunsteel/contracts';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** A YYYY-MM-DD calendar date as UTC midnight milliseconds; 400 if invalid. */
export function calendarDateMs(value: string): number {
  const match = CALENDAR_DATE.exec(value);
  const ms = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${value} is not a calendar date`);
  }
  return ms;
}

export const weekdayOf = (date: string) =>
  new Date(calendarDateMs(date)).getUTCDay();

export const daysBetween = (from: string, to: string) =>
  Math.round((calendarDateMs(to) - calendarDateMs(from)) / DAY_MS);

export const addCalendarDays = (date: string, days: number) =>
  new Date(calendarDateMs(date) + days * DAY_MS).toISOString().slice(0, 10);

/** Checks a read range: both ends dates, in order, and a bounded span. */
export function assertOverrideRange(from: string, to: string) {
  const span = daysBetween(from, to);
  if (span < 0) throw new BadRequestException('The range ends before it starts');
  if (span > SCHEDULE_OVERRIDES_MAX_RANGE_DAYS) {
    throw new BadRequestException(
      `Read at most ${SCHEDULE_OVERRIDES_MAX_RANGE_DAYS} days of overrides at once`,
    );
  }
}

interface OccurrenceRoutine {
  scheduleMode: RoutineScheduleMode;
  /** The weekdays of the routine's days. */
  trainingWeekdays: readonly number[];
}

type OtherOverride = {
  date: string;
  kind: ScheduleOverrideKind;
  toDate: string | null;
};

/** The server does not know the device's time zone: one day of slack. */
const utcToday = (now: Date) => now.toISOString().slice(0, 10);

function assertOccurrence(date: string, routine: OccurrenceRoutine) {
  if (routine.scheduleMode !== 'WEEKLY') {
    throw new BadRequestException(
      'Only weekly routines have dated workouts to change',
    );
  }
  if (!routine.trainingWeekdays.includes(weekdayOf(date))) {
    throw new BadRequestException('The routine is not planned on that date');
  }
}

export interface MoveInput {
  date: string;
  toDate: string;
  now: Date;
  routine: OccurrenceRoutine;
  /** The routine's other overrides (not the one for `date`). */
  others: readonly OtherOverride[];
}

/**
 * SCHED-04: one weekly occurrence moves to another date up to
 * SCHEDULE_MOVE_MAX_DAYS away, neither date in the past, and never onto a
 * date where the routine is already planned. A date whose own occurrence was
 * moved away or skipped (SCHED-05) is free. The server does not know the
 * device's time zone, so "past" allows one day of slack; the app applies the
 * exact local rule.
 */
export function assertMovable({ date, toDate, now, routine, others }: MoveInput) {
  assertOccurrence(date, routine);
  const distance = daysBetween(date, toDate);
  if (distance === 0) {
    throw new BadRequestException('Choose a different date');
  }
  if (Math.abs(distance) > SCHEDULE_MOVE_MAX_DAYS) {
    throw new BadRequestException(
      `A workout moves at most ${SCHEDULE_MOVE_MAX_DAYS} days`,
    );
  }
  const earliest = addCalendarDays(utcToday(now), -1);
  if (date < earliest || toDate < earliest) {
    throw new BadRequestException('Past workouts cannot be moved');
  }
  const freed = others.some(
    (o) => o.date === toDate && (o.kind === 'SKIP' || o.toDate),
  );
  if (routine.trainingWeekdays.includes(weekdayOf(toDate)) && !freed) {
    throw new ConflictException(
      'That date already has a workout of this routine',
    );
  }
  if (others.some((o) => o.toDate === toDate)) {
    throw new ConflictException(
      'Another workout of this routine already moved to that date',
    );
  }
}

/**
 * SCHED-05: a weekly occurrence is skipped on purpose, ahead of time or to
 * explain a day that passed up to SCHEDULE_SKIP_PAST_DAYS back (one more day
 * of slack for time zones). A moved occurrence is skipped as a whole.
 */
export function assertSkippable({
  date,
  now,
  routine,
}: {
  date: string;
  now: Date;
  routine: OccurrenceRoutine;
}) {
  assertOccurrence(date, routine);
  if (date < addCalendarDays(utcToday(now), -(SCHEDULE_SKIP_PAST_DAYS + 1))) {
    throw new BadRequestException(
      `A workout can be marked skipped up to ${SCHEDULE_SKIP_PAST_DAYS} days back`,
    );
  }
}
