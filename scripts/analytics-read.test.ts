import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DatabaseService } from '../src/database/database.service';
import { WorkoutProgressService } from '../src/workouts/workout-progress.service';

test('projected progress has three bounded reads in repeatable read, with static index predicates', async () => {
  const calls: Array<{ sql?: string; values?: unknown[]; query?: any }> = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      calls.push({ sql, values });
      return sql.includes('WorkoutAnalyticsProjection')
        ? [
            {
              totalVolumeKg: 12.625,
              lastTrainingDate: '2000-01-01',
              currentRun: 9,
              bestRun: 12,
            },
          ]
        : [];
    },
    personalRecord: {
      findMany: async (query: any) => {
        calls.push({ query });
        return [];
      },
    },
  };
  const db = {
    $transaction: async (read: any, options: any) => {
      assert.deepEqual(options, { isolationLevel: 'RepeatableRead' });
      return read(
        new Proxy(tx, {
          get(target, key) {
            assert.ok(key in target, `Unexpected read: ${String(key)}`);
            return Reflect.get(target, key);
          },
        }),
      );
    },
  } as unknown as DatabaseService;
  const response = await new WorkoutProgressService(db).getProgress(
    'user',
    { timeZone: 'Europe/Berlin' },
  );
  assert.deepEqual(response, {
    totalVolumeKg: 13,
    currentStreakDays: 0,
    bestStreakDays: 12,
    personalRecords: [],
    recentActivity: [],
  });
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql!, /LIMIT 1/);
  assert.deepEqual(calls[0].values, ['user', 'Europe/Berlin']);
  assert.equal(calls[1].query.take, 5);
  assert.match(
    calls[2].sql!,
    /"status" = 'COMPLETED' AND s."completedSets" > 0/,
  );
  assert.match(calls[2].sql!, /ORDER BY s."endedAt" DESC, s."id" DESC LIMIT 5/);
  assert.doesNotMatch(
    JSON.stringify(calls),
    /SetLog|TrainingEvent|WorkoutRollup/,
  );
});

test('missing projection rejects before any other reads', async () => {
  const db = {
    $transaction: async (read: any) => read({ $queryRaw: async () => [] }),
  } as unknown as DatabaseService;
  await assert.rejects(
    new WorkoutProgressService(db).getProgress('user', {
      timeZone: 'UTC',
    }),
    /not ready/,
  );
});
