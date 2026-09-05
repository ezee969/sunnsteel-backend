import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from 'class-validator';
import { DatabaseService } from '../src/database/database.service';
import { WorkoutSessionReadService } from '../src/workouts/workout-session-read.service';
import { WorkoutStatsQueryDto } from '../src/workouts/dto/workout-stats.dto';

const query = {
  weekStart: '2026-08-30T22:00:00.000Z',
  weekEnd: '2026-09-06T22:00:00.000Z',
  timeZone: 'Europe/Berlin',
};

function fixture(counts: { status: string; _count: { _all: number } }[], dates: string[]) {
  const calls: { kind: string; args: any }[] = [];
  const db = {
    workoutSession: {
      count: (args: { where: { userId: string; status?: string } }) => {
        calls.push({ kind: 'counts', args });
        return Promise.resolve(counts.filter(row => !args.where.status || row.status === args.where.status).reduce((sum, row) => sum + row._count._all, 0));
      },
      findMany: (args: unknown) => {
        calls.push({ kind: 'week', args });
        return Promise.resolve(
          dates.map((endedAt) => ({ endedAt: new Date(endedAt) })),
        );
      },
    },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  return {
    service: new WorkoutSessionReadService(db as unknown as DatabaseService),
    calls,
  };
}

test('counts full history, scopes all reads to the user, and groups local dates', async () => {
  const { service, calls } = fixture(
    [
      { status: 'COMPLETED', _count: { _all: 120 } },
      { status: 'ABORTED', _count: { _all: 29 } },
      { status: 'IN_PROGRESS', _count: { _all: 1 } },
    ],
    ['2026-09-01T21:30:00Z', '2026-09-01T22:30:00Z', '2026-09-02T10:00:00Z'],
  );
  assert.deepEqual(await service.getStats('owner', query), {
    totalCompleted: 120,
    completionRate: 80,
    weeklyWorkoutsCount: 3,
    activeDaysThisWeek: 2,
  });
  assert.ok(calls.every((call) => call.args.where.userId === 'owner'));
  assert.equal(calls[0].args.take, undefined);
  assert.equal(calls[1].args.where.status, 'COMPLETED');
  assert.deepEqual(calls[2].args.where.endedAt, {
    gte: new Date(query.weekStart),
    lt: new Date(query.weekEnd),
  });
  assert.deepEqual(calls[2].args.select, { endedAt: true });
});

test('empty history returns zero rather than NaN', async () => {
  assert.deepEqual(await fixture([], []).service.getStats('owner', query), {
    totalCompleted: 0,
    completionRate: 0,
    weeklyWorkoutsCount: 0,
    activeDaysThisWeek: 0,
  });
});

test('rejects unbounded and reversed ranges before accessing the database', async () => {
  const { service, calls } = fixture([], []);
  for (const weekEnd of [
    '2027-01-01T00:00:00Z',
    query.weekStart,
    '2020-01-01T00:00:00Z',
  ]) {
    await assert.rejects(service.getStats('owner', { ...query, weekEnd }));
  }
  assert.equal(calls.length, 0);
});

test('request validation rejects invalid dates and timezones', async () => {
  const valid = Object.assign(new WorkoutStatsQueryDto(), query);
  assert.equal((await validate(valid)).length, 0);
  const invalid = Object.assign(new WorkoutStatsQueryDto(), {
    ...query,
    weekStart: 'bad',
    timeZone: 'invalid/zone',
  });
  assert.equal((await validate(invalid)).length, 2);
});
