import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACHIEVEMENT_DEFINITIONS } from '@sunsteel/contracts';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { FeaturedProfileItemsService } from '../src/users/featured-profile-items.service';

const record = {
  exerciseId: 'exercise-1',
  exerciseName: 'Incline Press',
  weight: 40,
  reps: 10,
  estimated1rm: 53.3,
  achievedAt: new Date('2026-09-15T10:00:00.000Z'),
};

describe('FeaturedProfileItemsService', () => {
  it('normalizes order and replaces the whole selection under the account lock', async () => {
    let created: unknown;
    let locked = false;
    const tx = {
      $queryRaw: async () => {
        locked = true;
        return [];
      },
      featuredProfileItem: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async (args: unknown) => {
          created = args;
          return { count: 1 };
        },
      },
    };
    const db = {
      personalRecord: { findMany: async () => [record] },
      trainingEvent: { findMany: async () => [] },
      workoutAnalyticsProjection: { findFirst: async () => null },
      $transaction: async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
    } as unknown as DatabaseService;

    const result = await new FeaturedProfileItemsService(db).replace('user-1', [
      { kind: 'RECORD', referenceId: ' exercise-1 ' },
    ]);

    assert.equal(locked, true);
    assert.deepEqual(result, {
      items: [{ kind: 'RECORD', referenceId: 'exercise-1', position: 0 }],
    });
    assert.deepEqual(created, {
      data: [
        {
          userId: 'user-1',
          kind: 'RECORD',
          referenceId: 'exercise-1',
          position: 0,
        },
      ],
    });
  });

  it('rejects duplicate, unavailable and multiple-rank selections', async () => {
    const db = {
      personalRecord: { findMany: async () => [] },
      trainingEvent: { findMany: async () => [] },
      workoutAnalyticsProjection: { findFirst: async () => null },
    } as unknown as DatabaseService;
    const service = new FeaturedProfileItemsService(db);

    await assert.rejects(
      () =>
        service.replace('user-1', [
          { kind: 'RECORD', referenceId: 'exercise-1' },
          { kind: 'RECORD', referenceId: 'exercise-1' },
        ]),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.replace('user-1', [
          { kind: 'RECORD', referenceId: 'missing' },
        ]),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.replace('user-1', [
          { kind: 'RANK', referenceId: 'INITIATE' },
          { kind: 'RANK', referenceId: 'APPRENTICE' },
        ]),
      BadRequestException,
    );
  });

  it('accepts earned achievements and reached rank titles but rejects future ranks', async () => {
    const achievement = ACHIEVEMENT_DEFINITIONS[0];
    const created: Array<{ kind: string; referenceId: string }> = [];
    const tx = {
      $queryRaw: async () => [],
      featuredProfileItem: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async (args: {
          data: Array<{ kind: string; referenceId: string }>;
        }) => {
          created.push(...args.data);
          return { count: 2 };
        },
      },
    };
    const db = {
      personalRecord: { findMany: async () => [] },
      trainingEvent: {
        findMany: async () => [
          {
            id: 'event-1',
            sessionId: 'session-1',
            occurredAt: new Date('2026-09-15T10:00:00.000Z'),
            payload: {
              ...achievement,
              schemaVersion: 1,
              backfilled: false,
            },
          },
        ],
      },
      workoutAnalyticsProjection: {
        findFirst: async () => ({ id: 'projection-1', completedSessions: 15 }),
      },
      workoutRollup: { count: async () => 8 },
      $transaction: async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
    } as unknown as DatabaseService;
    const service = new FeaturedProfileItemsService(db);

    await service.replace('user-1', [
      { kind: 'ACHIEVEMENT', referenceId: achievement.id },
      { kind: 'RANK', referenceId: 'APPRENTICE' },
    ]);
    assert.deepEqual(
      created.map(item => [item.kind, item.referenceId]),
      [
        ['ACHIEVEMENT', achievement.id],
        ['RANK', 'APPRENTICE'],
      ],
    );

    await assert.rejects(
      () =>
        service.replace('user-1', [
          { kind: 'RANK', referenceId: 'MAESTRO' },
        ]),
      BadRequestException,
    );
  });

  it('omits private record references and resolves earned achievement and rank items', async () => {
    const achievement = ACHIEVEMENT_DEFINITIONS[0];
    const db = {
      featuredProfileItem: {
        findMany: async () => [
          { kind: 'RECORD', referenceId: 'exercise-1', position: 0 },
          { kind: 'ACHIEVEMENT', referenceId: achievement.id, position: 1 },
          { kind: 'RANK', referenceId: 'APPRENTICE', position: 2 },
        ],
      },
      personalRecord: {
        findMany: async () => {
          throw new Error('private records must not be queried');
        },
      },
      trainingEvent: {
        findMany: async () => [
          {
            id: 'event-1',
            sessionId: 'session-1',
            occurredAt: new Date('2026-09-15T10:00:00.000Z'),
            payload: {
              ...achievement,
              schemaVersion: 1,
              backfilled: false,
            },
          },
        ],
      },
      workoutAnalyticsProjection: {
        findFirst: async () => ({ id: 'projection-1', completedSessions: 5 }),
      },
      workoutRollup: { count: async () => 3 },
    } as unknown as DatabaseService;

    const result = await new FeaturedProfileItemsService(db).resolveForProfile(
      'user-1',
      { records: false, achievements: true },
    );

    assert.deepEqual(
      result.map(item => [item.kind, item.referenceId, item.position]),
      [
        ['ACHIEVEMENT', achievement.id, 1],
        ['RANK', 'APPRENTICE', 2],
      ],
    );
  });
});
