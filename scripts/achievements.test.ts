import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACHIEVEMENT_DEFINITIONS } from '@sunsteel/contracts';
import { DatabaseService } from '../src/database/database.service';
import {
  AchievementTotals,
  awardMilestoneAchievements,
  reachedAchievements,
} from '../src/achievements/achievement-events';
import { AchievementsService } from '../src/achievements/achievements.service';

const emptyTotals = (): AchievementTotals => ({
  sessions: 0,
  sets: 0,
  volumeKg: 0,
  records: 0,
  streakDays: 0,
});

test('achievement catalog has five bounded categories and stable unique ids', () => {
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 25);
  assert.equal(
    new Set(ACHIEVEMENT_DEFINITIONS.map(definition => definition.id)).size,
    25,
  );
  assert.deepEqual(
    new Set(ACHIEVEMENT_DEFINITIONS.map(definition => definition.category)),
    new Set(['SESSIONS', 'SETS', 'VOLUME_KG', 'RECORDS', 'STREAK_DAYS']),
  );
});

test('reached achievements compare each verified total to its own threshold', () => {
  const result = reachedAchievements({
    sessions: 10,
    sets: 99,
    volumeKg: 10_000,
    records: 5,
    streakDays: 3,
  });
  assert.deepEqual(
    result.map(definition => definition.id),
    [
      'sessions:1',
      'sessions:10',
      'sets:10',
      'volume_kg:1000',
      'volume_kg:10000',
      'records:1',
      'records:5',
      'streak_days:2',
      'streak_days:3',
    ],
  );
});

test('award writer is idempotent and emits addressable streak events', async () => {
  const rows = new Map<string, any>();
  const tx = {
    trainingEvent: {
      upsert: async (query: any) => {
        const key = query.where.eventKey as string;
        if (!rows.has(key)) rows.set(key, query.create);
        return rows.get(key);
      },
    },
  } as any;
  const input = {
    userId: 'user-1',
    sourceSessionId: 'session-1',
    occurredAt: new Date('2026-09-14T10:00:00.000Z'),
    totals: { ...emptyTotals(), streakDays: 3 },
    backfilled: false,
  };
  await awardMilestoneAchievements(tx, input);
  await awardMilestoneAchievements(tx, input);

  assert.equal(rows.size, 4);
  assert.equal(rows.get('achievement:user-1:streak_days:2:v1').sessionId, 'session-1');
  assert.equal(rows.get('streak:user-1:2:v1').type, 'STREAK_MILESTONE');
  assert.equal(rows.get('streak:user-1:3:v1').payload.streakDays, 3);
});

test('achievement read reconciles existing verified history once and stays bounded', async () => {
  const rows = new Map<string, any>();
  let requestedTake = 0;
  const tx = {
    $queryRaw: async () => [{ id: 'user-1' }],
    workoutAnalyticsProjection: {
      findFirst: async () => ({
        completedSessions: 10,
        completedSets: 99,
        totalVolumeKg: 10_000,
        bestRun: 3,
      }),
    },
    personalRecord: { count: async () => 5 },
    trainingEvent: {
      upsert: async (query: any) => {
        const key = query.where.eventKey as string;
        if (!rows.has(key)) {
          rows.set(key, {
            id: `event-${rows.size + 1}`,
            ...query.create,
          });
        }
        return rows.get(key);
      },
      findMany: async (query: any) => {
        requestedTake = query.take;
        return [...rows.values()]
          .filter(row => row.type === 'ACHIEVEMENT_UNLOCKED')
          .map(row => ({
            id: row.id,
            sessionId: row.sessionId,
            occurredAt: row.occurredAt,
            payload: row.payload,
          }));
      },
    },
  };
  const db = {
    $transaction: async (read: (client: typeof tx) => unknown, options: unknown) => {
      assert.deepEqual(options, { isolationLevel: 'RepeatableRead' });
      return read(tx);
    },
  } as unknown as DatabaseService;
  const service = new AchievementsService(db);
  const first = await service.list('user-1');
  const second = await service.list('user-1');

  assert.equal(first.analyticsReady, true);
  assert.equal(first.earnedCount, 9);
  assert.equal(first.availableCount, 25);
  assert.ok(first.achievements.every(achievement => achievement.backfilled));
  assert.ok(first.achievements.every(achievement => achievement.sourceSessionId === null));
  assert.equal(requestedTake, 25);
  assert.equal(second.earnedCount, first.earnedCount);
  assert.equal(rows.size, 11);
});
