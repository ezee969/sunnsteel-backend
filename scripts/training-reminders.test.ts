import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWithinQuietHours } from '@sunsteel/contracts';
import {
  isWithinReminderWindow,
  localClock,
} from '../src/notifications/push/local-time';
import { suppressionFor } from '../src/notifications/push/notification-preferences.service';
import {
  describePlannedRoutines,
  routinesPlannedOn,
  type ReminderRoutine,
} from '../src/notifications/push/training-days';

const CREATED = new Date('2026-01-01T00:00:00.000Z');

// 2026-09-17 is a Thursday, so weekday 4.
const THURSDAY = '2026-09-17';
const FRIDAY = '2026-09-18';

const weekly = (overrides: Partial<ReminderRoutine> = {}): ReminderRoutine => ({
  id: 'r1',
  name: 'Upper / Lower',
  scheduleMode: 'WEEKLY',
  isCompleted: false,
  createdAt: CREATED,
  days: [{ dayOfWeek: 4 }],
  restDays: [],
  rotationWeekdays: [],
  ...overrides,
});

const plan = (
  routines: ReminderRoutine[],
  overrides: Parameters<typeof routinesPlannedOn>[0]['overrides'] = [],
  trained: string[] = [],
  date = THURSDAY,
) =>
  routinesPlannedOn({
    date,
    routines,
    overrides,
    routineIdsTrainedOnDate: trained,
  });

test('a weekly routine is planned on its own weekday only', () => {
  assert.deepEqual(plan([weekly()]), ['Upper / Lower']);
  assert.deepEqual(plan([weekly()], [], [], FRIDAY), []);
});

test('an archived routine plans nothing', () => {
  assert.deepEqual(plan([weekly({ isCompleted: true })]), []);
});

test('a routine plans nothing before it existed', () => {
  assert.deepEqual(
    plan([weekly({ createdAt: new Date('2026-12-01T00:00:00.000Z') })]),
    [],
  );
});

test('a rest day is a plan not to train, not a missed workout', () => {
  assert.deepEqual(plan([weekly({ restDays: [4] })]), []);
});

test('a day already trained needs no reminder', () => {
  assert.deepEqual(plan([weekly()], [], ['r1']), []);
});

test('a workout moved away empties its date, and fills the target', () => {
  const moved = [
    { routineId: 'r1', kind: 'MOVE' as const, date: THURSDAY, toDate: FRIDAY },
  ];
  assert.deepEqual(plan([weekly()], moved), []);
  assert.deepEqual(plan([weekly()], moved, [], FRIDAY), ['Upper / Lower']);
});

test('a move onto a rest day still counts as a training day', () => {
  const routine = weekly({ days: [{ dayOfWeek: 2 }], restDays: [4] });
  const moved = [
    { routineId: 'r1', kind: 'MOVE' as const, date: '2026-09-15', toDate: THURSDAY },
  ];
  assert.deepEqual(plan([routine], moved), ['Upper / Lower']);
});

test('a skipped day produces no reminder', () => {
  const skipped = [
    { routineId: 'r1', kind: 'SKIP' as const, date: THURSDAY, toDate: null },
  ];
  assert.deepEqual(plan([weekly()], skipped), []);
});

test('a rotation is planned only on the weekdays it trains', () => {
  const rotation = weekly({
    scheduleMode: 'ROTATION',
    days: [{ dayOfWeek: null }],
    rotationWeekdays: [4],
  });
  assert.deepEqual(plan([rotation]), ['Upper / Lower']);
  assert.deepEqual(plan([rotation], [], [], FRIDAY), []);
});

test('a rotation with no training weekdays has no dates to remind about', () => {
  const undated = weekly({
    scheduleMode: 'ROTATION',
    days: [{ dayOfWeek: null }],
    rotationWeekdays: [],
  });
  assert.deepEqual(plan([undated]), []);
});

test('several routines on one day are all named, in order', () => {
  const second = weekly({ id: 'r2', name: 'Push Day' });
  assert.deepEqual(plan([weekly(), second]), ['Upper / Lower', 'Push Day']);
  assert.equal(
    describePlannedRoutines(['Upper / Lower', 'Push Day']),
    'Upper / Lower and Push Day',
  );
  assert.equal(describePlannedRoutines(['Push Day']), 'Push Day');
  assert.equal(describePlannedRoutines([]), '');
});

test('quiet hours cover a window that wraps past midnight', () => {
  const night = { startMinute: 22 * 60, endMinute: 7 * 60 };
  assert.equal(isWithinQuietHours(23 * 60, night), true);
  assert.equal(isWithinQuietHours(3 * 60, night), true);
  assert.equal(isWithinQuietHours(7 * 60, night), false, 'end is exclusive');
  assert.equal(isWithinQuietHours(22 * 60, night), true, 'start is inclusive');
  assert.equal(isWithinQuietHours(12 * 60, night), false);
});

test('a same-start-and-end window silences nothing', () => {
  assert.equal(isWithinQuietHours(600, { startMinute: 600, endMinute: 600 }), false);
});

test('no window silences nothing', () => {
  assert.equal(isWithinQuietHours(600, null), false);
});

const preferences = (overrides: Record<string, unknown> = {}) => ({
  categories: { REST_ALERT: true, TRAINING_REMINDER: true },
  quietHours: null,
  reminder: { minuteOfDay: null },
  timeZone: 'Europe/Berlin',
  ...overrides,
});

/** Pins the local clock at 23:00 so the window tests do not depend on now. */
const minuteAt = () => 23 * 60;

test('a switched-off category suppresses before quiet hours are consulted', () => {
  const result = suppressionFor(
    'REST_ALERT',
    preferences({ categories: { REST_ALERT: false, TRAINING_REMINDER: true } }) as never,
    new Date(),
    minuteAt,
  );
  assert.equal(result, 'CATEGORY_OFF');
});

test('quiet hours suppress a category that is otherwise on', () => {
  const result = suppressionFor(
    'REST_ALERT',
    preferences({ quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 } }) as never,
    new Date(),
    minuteAt,
  );
  assert.equal(result, 'QUIET_HOURS');
});

test('one category being off never silences the other', () => {
  const prefs = preferences({
    categories: { REST_ALERT: false, TRAINING_REMINDER: true },
  }) as never;
  assert.equal(suppressionFor('TRAINING_REMINDER', prefs, new Date(), minuteAt), null);
});

test('quiet hours cannot be evaluated without a zone, so nothing is silenced', () => {
  const result = suppressionFor(
    'REST_ALERT',
    preferences({
      timeZone: null,
      quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 },
    }) as never,
    new Date(),
    minuteAt,
  );
  assert.equal(result, null);
});

test('the reminder window opens at the chosen minute and is bounded', () => {
  assert.equal(isWithinReminderWindow(18 * 60, 18 * 60, 10), true);
  assert.equal(isWithinReminderWindow(18 * 60 + 9, 18 * 60, 10), true);
  assert.equal(isWithinReminderWindow(18 * 60 + 10, 18 * 60, 10), false);
  // Never fires early, and never wraps midnight onto the wrong date.
  assert.equal(isWithinReminderWindow(18 * 60 - 1, 18 * 60, 10), false);
  assert.equal(isWithinReminderWindow(5, 23 * 60 + 58, 10), false);
});

test('the local clock reads the wall clock of the zone, not the server', () => {
  // 2026-09-17T20:30Z is 22:30 in Berlin (CEST) and 13:30 in Los Angeles.
  const at = new Date('2026-09-17T20:30:00.000Z');
  assert.deepEqual(localClock(at, 'Europe/Berlin'), {
    date: '2026-09-17',
    minuteOfDay: 22 * 60 + 30,
  });
  assert.deepEqual(localClock(at, 'America/Los_Angeles'), {
    date: '2026-09-17',
    minuteOfDay: 13 * 60 + 30,
  });
});

test('a zone already past midnight reports the next local date', () => {
  // 23:30Z on the 17th is 01:30 on the 18th in Berlin.
  const at = new Date('2026-09-17T23:30:00.000Z');
  assert.deepEqual(localClock(at, 'Europe/Berlin'), {
    date: '2026-09-18',
    minuteOfDay: 90,
  });
});

test('local midnight is minute zero, not 1440', () => {
  const at = new Date('2026-09-17T22:00:00.000Z');
  assert.equal(localClock(at, 'Europe/Berlin').minuteOfDay, 0);
});
