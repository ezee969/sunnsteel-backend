import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ProfileVisibility,
  RoutineVisibility,
} from '@sunsteel/contracts';
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

const stranger = { isOwner: false, isFollower: false };
const follower = { isOwner: false, isFollower: true };
const owner = { isOwner: true, isFollower: false };

const routineRow = (id: string, visibility: RoutineVisibility) => ({
  id,
  name: 'Upper / Lower',
  description: null,
  scheduleMode: 'WEEKLY' as const,
  visibility,
  updatedAt: new Date('2026-09-17T10:00:00.000Z'),
  days: [{ _count: { exercises: 4 } }, { _count: { exercises: 3 } }],
});

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
      { isOwner: false, isFollower: true },
    );

    assert.deepEqual(
      result.map(item => [item.kind, item.referenceId, item.position]),
      [
        ['ACHIEVEMENT', achievement.id, 1],
        ['RANK', 'APPRENTICE', 2],
      ],
    );
  });
  it('offers only routines somebody else could reach, capped by the account rule', async () => {
    // PROF-08: a routine the PROF-06 routines rule caps to PRIVATE is not
    // offered, because featuring it would show the owner a slot nobody else
    // can see.
    const routines = [
      routineRow('routine-public', 'PUBLIC'),
      routineRow('routine-private', 'PRIVATE'),
    ];
    const created: Array<{ kind: string; referenceId: string }> = [];
    const tx = {
      $queryRaw: async () => [],
      featuredProfileItem: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async (args: {
          data: Array<{ kind: string; referenceId: string }>;
        }) => {
          created.push(...args.data);
          return { count: 1 };
        },
      },
    };
    const db = (routinesVisibility: ProfileVisibility) =>
      ({
        personalRecord: { findMany: async () => [] },
        trainingEvent: { findMany: async () => [] },
        workoutAnalyticsProjection: { findFirst: async () => null },
        user: { findUnique: async () => ({ routinesVisibility }) },
        routine: { findMany: async () => routines },
        $transaction: async (callback: (client: typeof tx) => unknown) =>
          callback(tx),
      }) as unknown as DatabaseService;

    await new FeaturedProfileItemsService(db('PUBLIC')).replace('user-1', [
      { kind: 'ROUTINE', referenceId: 'routine-public' },
    ]);
    assert.deepEqual(created, [
      {
        userId: 'user-1',
        kind: 'ROUTINE',
        referenceId: 'routine-public',
        position: 0,
      },
    ]);

    await assert.rejects(
      () =>
        new FeaturedProfileItemsService(db('PUBLIC')).replace('user-1', [
          { kind: 'ROUTINE', referenceId: 'routine-private' },
        ]),
      BadRequestException,
      'a private routine is not featurable',
    );
    await assert.rejects(
      () =>
        new FeaturedProfileItemsService(db('PRIVATE')).replace('user-1', [
          { kind: 'ROUTINE', referenceId: 'routine-public' },
        ]),
      BadRequestException,
      'the account routines rule caps the routine',
    );
  });

  it('resolves a featured routine through canViewRoutine, narrower rule first', async () => {
    const resolve = async (
      routinesVisibility: ProfileVisibility,
      visibility: RoutineVisibility,
      viewer: { isOwner: boolean; isFollower: boolean },
    ) => {
      const db = {
        featuredProfileItem: {
          findMany: async () => [
            { kind: 'ROUTINE', referenceId: 'routine-1', position: 0 },
          ],
        },
        personalRecord: { findMany: async () => [] },
        trainingEvent: { findMany: async () => [] },
        workoutAnalyticsProjection: { findFirst: async () => null },
        user: { findUnique: async () => ({ routinesVisibility }) },
        routine: {
          findMany: async () => [routineRow('routine-1', visibility)],
        },
      } as unknown as DatabaseService;
      return new FeaturedProfileItemsService(db).resolveForProfile(
        'user-1',
        { records: false, achievements: false },
        viewer,
      );
    };

    const shown = await resolve('PUBLIC', 'PUBLIC', stranger);
    assert.deepEqual(shown.map(item => item.kind), ['ROUTINE']);
    assert.deepEqual(
      shown[0].kind === 'ROUTINE' ? shown[0].routine : null,
      {
        routineId: 'routine-1',
        name: 'Upper / Lower',
        description: null,
        scheduleMode: 'WEEKLY',
        dayCount: 2,
        exerciseCount: 7,
        updatedAt: '2026-09-17T10:00:00.000Z',
      },
    );

    // The account rule caps the routine, never the reverse.
    assert.deepEqual(await resolve('FOLLOWERS', 'PUBLIC', stranger), []);
    assert.deepEqual(
      (await resolve('FOLLOWERS', 'PUBLIC', follower)).map(item => item.kind),
      ['ROUTINE'],
    );
    // A slot the viewer may not see is omitted, not emptied.
    assert.deepEqual(await resolve('PUBLIC', 'PRIVATE', follower), []);
    assert.deepEqual(
      (await resolve('PRIVATE', 'PRIVATE', owner)).map(item => item.kind),
      ['ROUTINE'],
    );
  });
});
