import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACHIEVEMENT_DEFINITIONS,
  COMEBACK_SESSION_LOOKBACK,
} from '@sunsteel/contracts';
import { DatabaseService } from '../src/database/database.service';
import {
  AchievementTotals,
  achievementCategoryProgress,
  awardMilestoneAchievements,
  reachedAchievements,
} from '../src/achievements/achievement-events';
import { AchievementsService } from '../src/achievements/achievements.service';
import { comebackRecognitionSummary } from '../src/achievements/comeback-recognition';
import { renaissanceRankProgress } from '../src/achievements/renaissance-ranks';

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

test('category progress returns only the next fixed milestone in catalog order', () => {
  const progress = achievementCategoryProgress({
    sessions: 10,
    sets: 99,
    volumeKg: 10_000,
    records: 5,
    streakDays: 3,
  });

  assert.deepEqual(
    progress.map(item => ({
      category: item.category,
      currentValue: item.currentValue,
      nextId: item.nextMilestone?.id ?? null,
      remaining: item.remaining,
    })),
    [
      {
        category: 'SESSIONS',
        currentValue: 10,
        nextId: 'sessions:25',
        remaining: 15,
      },
      {
        category: 'SETS',
        currentValue: 99,
        nextId: 'sets:100',
        remaining: 1,
      },
      {
        category: 'VOLUME_KG',
        currentValue: 10_000,
        nextId: 'volume_kg:50000',
        remaining: 40_000,
      },
      {
        category: 'RECORDS',
        currentValue: 5,
        nextId: 'records:10',
        remaining: 5,
      },
      {
        category: 'STREAK_DAYS',
        currentValue: 3,
        nextId: 'streak_days:5',
        remaining: 2,
      },
    ],
  );
});

test('completed categories retain verified totals without inventing another milestone', () => {
  const progress = achievementCategoryProgress({
    sessions: 120,
    sets: 1_200,
    volumeKg: 300_000,
    records: 55,
    streakDays: 25,
  });

  assert.ok(progress.every(item => item.nextMilestone === null));
  assert.ok(progress.every(item => item.remaining === 0));
  assert.deepEqual(
    progress.map(item => item.currentValue),
    [120, 1_200, 300_000, 55, 25],
  );
});

test('Renaissance ranks require both participation and active weeks', () => {
  assert.equal(renaissanceRankProgress(100, 2).currentRank.id, 'INITIATE');

  const artisan = renaissanceRankProgress(18, 8);
  assert.equal(artisan.currentRank.id, 'ARTISAN');
  assert.equal(artisan.nextRank?.id, 'MAESTRO');
  assert.equal(artisan.sessionsRemaining, 12);
  assert.equal(artisan.activeWeeksRemaining, 8);

  const laureate = renaissanceRankProgress(120, 60);
  assert.equal(laureate.currentRank.id, 'LAUREATE');
  assert.equal(laureate.nextRank, null);
  assert.equal(laureate.sessionsRemaining, 0);
  assert.equal(laureate.activeWeeksRemaining, 0);
});

test('comeback recognition requires a full break and three distinct active days', () => {
  const event = (id: string, occurredAt: string) => ({
    id,
    sessionId: `session-${id}`,
    occurredAt: new Date(occurredAt),
  });
  const summary = comebackRecognitionSummary(
    [
      event('before', '2026-01-01T12:00:00.000Z'),
      event('return', '2026-01-16T08:00:00.000Z'),
      event('same-day', '2026-01-16T18:00:00.000Z'),
      event('second-day', '2026-01-22T12:00:00.000Z'),
      event('recognized', '2026-01-29T12:00:00.000Z'),
    ],
    'UTC',
    false,
  );

  assert.equal(summary.minimumInactiveDays, 14);
  assert.equal(summary.requiredActiveDays, 3);
  assert.equal(summary.windowDays, 14);
  assert.deepEqual(summary.recognitions, [
    {
      id: 'comeback:return:recognized:v1',
      inactiveDays: 14,
      returnedAt: '2026-01-16T08:00:00.000Z',
      recognizedAt: '2026-01-29T12:00:00.000Z',
      sourceSessionId: 'session-recognized',
      activeDays: 3,
      windowDays: 14,
    },
  ]);
});

test('comeback recognition rejects short breaks, same-day volume and late returns', () => {
  const event = (id: string, date: string) => ({
    id,
    sessionId: `session-${id}`,
    occurredAt: new Date(`${date}T12:00:00.000Z`),
  });

  assert.deepEqual(
    comebackRecognitionSummary(
      [
        event('before', '2026-01-01'),
        event('short-return', '2026-01-15'),
        event('same-one', '2026-01-15'),
        event('same-two', '2026-01-15'),
        event('break-return', '2026-02-01'),
        event('second-day', '2026-02-08'),
        event('too-late', '2026-02-15'),
      ],
      'UTC',
      true,
    ).recognitions,
    [],
  );
});

test('award writer is idempotent and emits addressable streak events', async () => {
  const rows = new Map<string, any>();
  let createManyCalls = 0;
  const tx = {
    trainingEvent: {
      createMany: async (query: any) => {
        createManyCalls += 1;
        assert.equal(query.skipDuplicates, true);
        for (const row of query.data) {
          if (!rows.has(row.eventKey)) rows.set(row.eventKey, row);
        }
        return { count: query.data.length };
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

  assert.equal(createManyCalls, 2);
  assert.equal(rows.size, 4);
  assert.equal(rows.get('achievement:user-1:streak_days:2:v1').sessionId, 'session-1');
  assert.equal(rows.get('streak:user-1:2:v1').type, 'STREAK_MILESTONE');
  assert.equal(rows.get('streak:user-1:3:v1').payload.streakDays, 3);
});

test('achievement read reconciles existing verified history once and stays bounded', async () => {
  const rows = new Map<string, any>();
  let requestedTake = 0;
  let requestedComebackTake = 0;
  let activeWeekWhere: unknown;
  const tx = {
    $queryRaw: async () => [{ id: 'user-1' }],
    workoutAnalyticsProjection: {
      findFirst: async () => ({
        id: 'projection-1',
        completedSessions: 10,
        completedSets: 99,
        totalVolumeKg: 10_000,
        bestRun: 3,
      }),
    },
    workoutRollup: {
      count: async (query: any) => {
        activeWeekWhere = query.where;
        return 4;
      },
    },
    personalRecord: { count: async () => 5 },
    trainingEvent: {
      createMany: async (query: any) => {
        for (const row of query.data) {
          if (!rows.has(row.eventKey)) {
            rows.set(row.eventKey, {
              id: `event-${rows.size + 1}`,
              ...row,
            });
          }
        }
        return { count: query.data.length };
      },
      findMany: async (query: any) => {
        if (query.where.type === 'SESSION_COMPLETED') {
          requestedComebackTake = query.take;
          return [];
        }
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
  const profile = await service.forProfile('user-1');

  assert.equal(first.analyticsReady, true);
  assert.equal(first.earnedCount, 9);
  assert.equal(first.availableCount, 25);
  assert.equal(first.rank?.currentRank.id, 'APPRENTICE');
  assert.equal(first.rank?.nextRank?.id, 'ARTISAN');
  assert.equal(first.rank?.completedSessions, 10);
  assert.equal(first.rank?.activeWeeks, 4);
  assert.deepEqual(first.comeback, {
    minimumInactiveDays: 14,
    requiredActiveDays: 3,
    windowDays: 14,
    recognitions: [],
    historyTruncated: false,
  });
  assert.deepEqual(
    first.milestoneProgress.map(item => item.nextMilestone?.id ?? null),
    [
      'sessions:25',
      'sets:100',
      'volume_kg:50000',
      'records:10',
      'streak_days:5',
    ],
  );
  assert.deepEqual(activeWeekWhere, {
    projectionId: 'projection-1',
    period: 'WEEK',
    sessions: { gt: 0 },
  });
  assert.ok(first.achievements.every(achievement => achievement.backfilled));
  assert.ok(first.achievements.every(achievement => achievement.sourceSessionId === null));
  assert.equal(requestedTake, 25);
  assert.equal(requestedComebackTake, COMEBACK_SESSION_LOOKBACK + 1);
  assert.equal(second.earnedCount, first.earnedCount);
  assert.deepEqual(profile, {
    rank: first.rank?.currentRank,
    achievements: first.achievements,
    comeback: first.comeback,
  });
  assert.equal('nextRank' in (profile.rank ?? {}), false);
  assert.equal(rows.size, 11);
});
