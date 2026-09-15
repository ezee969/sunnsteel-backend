import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import {
  addCalendarDays,
  assertMovable,
  assertOverrideRange,
  daysBetween,
  weekdayOf,
} from '../src/schedule/schedule-overrides';
import { ScheduleOverridesService } from '../src/schedule/schedule-overrides.service';

// Tuesday 15 Sep 2026. The routine trains Monday, Wednesday and Friday.
const NOW = new Date('2026-09-15T12:00:00.000Z');
const weekly = { scheduleMode: 'WEEKLY' as const, trainingWeekdays: [1, 3, 5] };

test('calendar dates are checked and counted in whole days', () => {
  assert.equal(weekdayOf('2026-09-16'), 3);
  assert.equal(daysBetween('2026-09-14', '2026-09-20'), 6);
  assert.equal(daysBetween('2026-09-20', '2026-09-14'), -6);
  assert.equal(addCalendarDays('2026-09-30', 1), '2026-10-01');
  assert.throws(() => weekdayOf('2026-02-30'), BadRequestException);
  assert.throws(() => weekdayOf('16/09/2026'), BadRequestException);
  assert.doesNotThrow(() => assertOverrideRange('2026-08-31', '2026-10-12'));
  assert.throws(
    () => assertOverrideRange('2026-09-20', '2026-09-14'),
    /ends before/,
  );
  assert.throws(
    () => assertOverrideRange('2026-01-01', '2026-06-01'),
    /at most 62 days/,
  );
});

test('a planned weekly workout moves up to six days onto a free date', () => {
  const move = (date: string, toDate: string, others: any[] = []) =>
    assertMovable({ date, toDate, now: NOW, routine: weekly, others });
  // Wednesday to Thursday, and back across the week to Tuesday.
  assert.doesNotThrow(() => move('2026-09-16', '2026-09-17'));
  assert.doesNotThrow(() => move('2026-09-18', '2026-09-15'));
  assert.throws(() => move('2026-09-17', '2026-09-19'), /not planned/);
  assert.throws(() => move('2026-09-16', '2026-09-16'), /different date/);
  assert.throws(() => move('2026-09-16', '2026-09-23'), /at most 6 days/);
  // The server allows one day of slack for time zones, not more.
  assert.doesNotThrow(() => move('2026-09-14', '2026-09-15'));
  assert.throws(() => move('2026-09-11', '2026-09-15'), /Past workouts/);
  // Friday is already planned, unless its own workout moved away.
  assert.throws(() => move('2026-09-16', '2026-09-18'), ConflictException);
  assert.doesNotThrow(() =>
    move('2026-09-16', '2026-09-18', [
      { date: '2026-09-18', toDate: '2026-09-19' },
    ]),
  );
  // Another workout of the routine already moved onto Thursday.
  assert.throws(
    () =>
      move('2026-09-16', '2026-09-17', [
        { date: '2026-09-18', toDate: '2026-09-17' },
      ]),
    /already moved to that date/,
  );
  assert.throws(
    () =>
      assertMovable({
        date: '2026-09-16',
        toDate: '2026-09-17',
        now: NOW,
        routine: { scheduleMode: 'ROTATION', trainingWeekdays: [] },
        others: [],
      }),
    /Only weekly routines/,
  );
});

type Row = {
  id: string;
  userId: string;
  routineId: string;
  date: string;
  kind: 'MOVE';
  toDate: string | null;
  createdAt: Date;
};

function fakeDb(rows: Row[]) {
  const reads: any[] = [];
  const tx = {
    $queryRaw: async () => [],
    routine: {
      findFirst: async (query: any) =>
        query.where.id === 'split' && query.where.userId === 'u1'
          ? {
              scheduleMode: 'WEEKLY',
              days: [{ dayOfWeek: 1 }, { dayOfWeek: 3 }, { dayOfWeek: 5 }],
            }
          : null,
    },
    scheduleOverride: {
      findMany: async (query: any) => {
        reads.push(query);
        if (query.where.OR) {
          return rows.filter((row) => row.userId === query.where.userId);
        }
        return rows.filter(
          (row) =>
            row.routineId === query.where.routineId &&
            row.date !== query.where.NOT.date,
        );
      },
      upsert: async (query: any) => {
        const { routineId, date } = query.where.routineId_date;
        const existing = rows.find(
          (row) => row.routineId === routineId && row.date === date,
        );
        if (existing) {
          Object.assign(existing, query.update);
          return existing;
        }
        const row = {
          id: `o${rows.length + 1}`,
          createdAt: new Date(),
          ...query.create,
        };
        rows.push(row);
        return row;
      },
      deleteMany: async (query: any) => {
        const before = rows.length;
        const kept = rows.filter(
          (row) => !(row.id === query.where.id && row.userId === query.where.userId),
        );
        rows.splice(0, rows.length, ...kept);
        return { count: before - kept.length };
      },
    },
  };
  const db = {
    ...tx,
    $transaction: async (run: any) => run(tx),
  } as unknown as DatabaseService;
  return { service: new ScheduleOverridesService(db), reads };
}

test('moving again changes the target, and undoing removes the override', async () => {
  const rows: Row[] = [];
  const { service, reads } = fakeDb(rows);
  const first = await service.move(
    'u1',
    { routineId: 'split', date: '2026-09-16', toDate: '2026-09-17' },
    NOW,
  );
  assert.deepEqual(
    [first.date, first.kind, first.toDate, typeof first.createdAt],
    ['2026-09-16', 'MOVE', '2026-09-17', 'string'],
  );
  const again = await service.move(
    'u1',
    { routineId: 'split', date: '2026-09-16', toDate: '2026-09-15' },
    NOW,
  );
  assert.equal(again.id, first.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].toDate, '2026-09-15');

  const list = await service.list('u1', '2026-09-14', '2026-09-20');
  assert.deepEqual(
    list.overrides.map((o) => [o.date, o.toDate]),
    [['2026-09-16', '2026-09-15']],
  );
  const range = reads.find((query) => query.where.OR);
  assert.deepEqual(range.where.OR, [
    { date: { gte: '2026-09-14', lte: '2026-09-20' } },
    { toDate: { gte: '2026-09-14', lte: '2026-09-20' } },
  ]);

  await service.remove('u1', first.id);
  assert.equal(rows.length, 0);
  await assert.rejects(service.remove('u1', first.id), NotFoundException);
  await assert.rejects(
    service.move(
      'u1',
      { routineId: 'other', date: '2026-09-16', toDate: '2026-09-17' },
      NOW,
    ),
    NotFoundException,
  );
});
