import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { routineDayLabel } from '@sunsteel/contracts';
import { DatabaseService } from '../src/database/database.service';
import {
  nextRotationDayId,
  normalizeRestDays,
  normalizeRoutineDays,
} from '../src/routines/routine-schedule';
import { RoutinesService } from '../src/routines/routines.service';

const day = (
  extra: { dayOfWeek?: number | null; name?: string | null; order?: number } = {},
) => ({
  exercises: [],
  ...extra,
});

test('weekly days keep distinct weekdays and trimmed names', () => {
  const days = normalizeRoutineDays('WEEKLY', [
    day({ dayOfWeek: 1, name: '  Push ' }),
    day({ dayOfWeek: 3, name: '   ' }),
  ]);
  assert.deepEqual(
    days.map(({ dayOfWeek, name, order }) => ({ dayOfWeek, name, order })),
    [
      { dayOfWeek: 1, name: 'Push', order: 0 },
      { dayOfWeek: 3, name: null, order: 1 },
    ],
  );
  assert.throws(
    () => normalizeRoutineDays('WEEKLY', [day()]),
    BadRequestException,
  );
  assert.throws(
    () =>
      normalizeRoutineDays('WEEKLY', [
        day({ dayOfWeek: 2 }),
        day({ dayOfWeek: 2 }),
      ]),
    /only once/,
  );
  assert.throws(
    () =>
      normalizeRoutineDays('WEEKLY', [day({ dayOfWeek: 2, name: 'x'.repeat(41) })]),
    /at most 40/,
  );
  assert.throws(
    () =>
      normalizeRoutineDays(
        'WEEKLY',
        Array.from({ length: 8 }, (_, dow) => day({ dayOfWeek: dow % 7 })),
      ),
    /at most 7 days/,
  );
});

test('rotation days have no weekday and run in their given order', () => {
  const days = normalizeRoutineDays('ROTATION', [
    day({ name: 'Legs', order: 5 }),
    day({ name: 'Push', order: 1 }),
    day({ dayOfWeek: null, order: 3 }),
  ]);
  assert.deepEqual(
    days.map(({ dayOfWeek, name, order }) => ({ dayOfWeek, name, order })),
    [
      { dayOfWeek: null, name: 'Push', order: 0 },
      { dayOfWeek: null, name: null, order: 1 },
      { dayOfWeek: null, name: 'Legs', order: 2 },
    ],
  );
  assert.throws(
    () => normalizeRoutineDays('ROTATION', [day({ dayOfWeek: 1 })]),
    /no weekday/,
  );
});

test('the next rotation day follows the last completed session and wraps', () => {
  const days = [
    { id: 'c', order: 2 },
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
  ];
  assert.equal(nextRotationDayId([], null), null);
  assert.equal(nextRotationDayId(days, null), 'a');
  assert.equal(nextRotationDayId(days, { routineDayId: 'a', order: 0 }), 'b');
  assert.equal(nextRotationDayId(days, { routineDayId: 'c', order: 2 }), 'a');
  // The day was replaced by an edit: continue from the order it had.
  assert.equal(nextRotationDayId(days, { routineDayId: null, order: 1 }), 'c');
  assert.equal(nextRotationDayId(days, { routineDayId: 'gone', order: 4 }), 'a');
  assert.equal(nextRotationDayId(days, { routineDayId: null, order: null }), 'a');
});

test('a day is named by its name, else its weekday, else its rotation letter', () => {
  assert.equal(routineDayLabel({ name: ' Upper A ', dayOfWeek: 1 }), 'Upper A');
  assert.equal(routineDayLabel({ name: null, dayOfWeek: 4, order: 0 }), 'Thursday');
  assert.equal(routineDayLabel({ dayOfWeek: null, order: 1 }), 'Day B');
  assert.equal(routineDayLabel({}), '');
});

const entity = (
  id: string,
  scheduleMode: 'WEEKLY' | 'ROTATION',
  days: Array<{ id: string; order: number; dayOfWeek: number | null }>,
) => ({
  id,
  userId: 'user-1',
  name: id,
  description: null,
  isPeriodized: false,
  isFavorite: false,
  isCompleted: false,
  scheduleMode,
  restDays: [] as number[],
  createdAt: new Date('2026-09-01T10:00:00.000Z'),
  updatedAt: new Date('2026-09-01T10:00:00.000Z'),
  days: days.map((d) => ({ ...d, name: null, exercises: [] })),
});

test('routine reads report the next rotation day from the last completed session', async () => {
  const lookups: any[] = [];
  const db = {
    routine: {
      findMany: async () => [
        entity('weekly', 'WEEKLY', [{ id: 'w1', order: 0, dayOfWeek: 1 }]),
        entity('ppl', 'ROTATION', [
          { id: 'push', order: 0, dayOfWeek: null },
          { id: 'pull', order: 1, dayOfWeek: null },
          { id: 'legs', order: 2, dayOfWeek: null },
        ]),
      ],
    },
    workoutSession: {
      findFirst: async (query: any) => {
        lookups.push(query);
        return {
          routineDayId: 'pull',
          snapshot: { payload: { routineDay: { order: 1 } } },
        };
      },
    },
  } as unknown as DatabaseService;
  const [weekly, rotation] = await new RoutinesService(db).findAll('user-1');
  assert.equal(weekly.scheduleMode, 'WEEKLY');
  assert.equal(weekly.nextRotationDayId, null);
  assert.equal(rotation.nextRotationDayId, 'legs');
  assert.equal(lookups.length, 1);
  assert.deepEqual(lookups[0].where, {
    userId: 'user-1',
    routineId: 'ppl',
    status: 'COMPLETED',
  });
});

test('creating a rotation routine stores null weekdays and the mode', async () => {
  let created: any;
  const db = {
    routine: {
      create: async (query: any) => {
        created = query.data;
        return entity('ppl', 'ROTATION', [
          { id: 'push', order: 0, dayOfWeek: null },
        ]);
      },
    },
    workoutSession: { findFirst: async () => null },
  } as unknown as DatabaseService;
  const service = new RoutinesService(db);
  const routine = await service.create('user-1', {
    name: 'PPL',
    isPeriodized: false,
    scheduleMode: 'ROTATION',
    days: [{ name: 'Push', exercises: [] }],
  });
  assert.equal(created.scheduleMode, 'ROTATION');
  assert.deepEqual(
    created.days.create.map((d: any) => [d.dayOfWeek, d.name, d.order]),
    [[null, 'Push', 0]],
  );
  assert.equal(routine.nextRotationDayId, 'push');
  await assert.rejects(
    service.create('user-1', {
      name: 'PPL',
      isPeriodized: false,
      scheduleMode: 'ROTATION',
      days: [{ dayOfWeek: 1, exercises: [] }],
    }),
    BadRequestException,
  );
});

test('changing the schedule mode without days is refused', async () => {
  const tx = {
    $queryRaw: async () => [],
    workoutSession: { findFirst: async () => null },
    routine: {
      findFirst: async () => ({ id: 'ppl', scheduleMode: 'WEEKLY' }),
      update: async () => {
        throw new Error('must not update');
      },
    },
  };
  const db = {
    $transaction: async (fn: (client: unknown) => unknown) => fn(tx),
  } as unknown as DatabaseService;
  await assert.rejects(
    new RoutinesService(db).update('user-1', 'ppl', {
      scheduleMode: 'ROTATION',
    }),
    /requires the routine days/,
  );
});

test('rest days belong to weekly routines and never repeat a training day', () => {
  const days = [{ dayOfWeek: 1 }, { dayOfWeek: 3 }, { dayOfWeek: 5 }];
  assert.deepEqual(normalizeRestDays('WEEKLY', days, [6, 0, 6]), [0, 6]);
  assert.throws(
    () => normalizeRestDays('WEEKLY', days, [3]),
    /cannot also be a training day/,
  );
  // Kept rest days drop the ones an edit turned into training days.
  assert.deepEqual(
    normalizeRestDays('WEEKLY', [{ dayOfWeek: 0 }], undefined, [0, 3]),
    [3],
  );
  assert.deepEqual(normalizeRestDays('ROTATION', [], undefined, [2]), []);
  assert.throws(
    () => normalizeRestDays('ROTATION', [{ dayOfWeek: null }], [2]),
    /no rest days/,
  );
});

test('creating a weekly routine stores its rest days', async () => {
  let created: any;
  const db = {
    routine: {
      create: async (query: any) => {
        created = query.data;
        return {
          ...entity('split', 'WEEKLY', [{ id: 'mon', order: 0, dayOfWeek: 1 }]),
          restDays: query.data.restDays,
        };
      },
    },
  } as unknown as DatabaseService;
  const routine = await new RoutinesService(db).create('user-1', {
    name: 'Split',
    isPeriodized: false,
    restDays: [3, 0],
    days: [{ dayOfWeek: 1, exercises: [] }],
  });
  assert.deepEqual(created.restDays, [0, 3]);
  assert.deepEqual(routine.restDays, [0, 3]);
});
