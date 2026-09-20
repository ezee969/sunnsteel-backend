import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { WorkoutSessionRecap } from '@sunsteel/contracts';

import { DatabaseService } from '../src/database/database.service';
import { WorkoutSessionRecapService } from '../src/workouts/services';
import {
  createShareToken,
  normalizeShareFields,
  projectSharedRecap,
  WorkoutSessionShareService,
} from '../src/workouts/workout-session-share.service';

const recap: WorkoutSessionRecap = {
  sessionId: 'session-1',
  routineName: 'Upper / Lower',
  dayName: 'Monday',
  startedAt: '2026-09-01T10:00:00.000Z',
  endedAt: '2026-09-01T11:00:00.000Z',
  durationSec: 3600,
  totalVolumeKg: 5400,
  completedSets: 18,
  notes: 'Felt strong.',
  records: [
    {
      kind: 'WEIGHT',
      exerciseId: 'bench',
      exerciseName: 'Bench Press',
      value: 100,
      setNumber: 2,
      achievedAt: '2026-09-01T10:30:00.000Z',
    },
  ],
  progressionChanges: [],
  previousSession: null,
};

const owner = { username: 'atlas', name: 'Ana', lastName: null, avatarUrl: null };
const token = 'A'.repeat(24);

function service(db: unknown, recaps?: Partial<WorkoutSessionRecapService>) {
  return new WorkoutSessionShareService(
    db as DatabaseService,
    (recaps ?? {}) as WorkoutSessionRecapService,
  );
}

describe('share fields and tokens', () => {
  it('keeps known fields in canonical order and drops the rest', () => {
    assert.deepEqual(
      normalizeShareFields(['notes', 'bogus', 'duration', 'notes']),
      ['duration', 'notes'],
    );
  });

  it('creates unguessable 24-character URL-safe tokens', () => {
    const first = createShareToken();
    assert.match(first, /^[A-Za-z0-9_-]{24}$/);
    assert.notEqual(first, createShareToken());
  });

  it('omits every field the owner did not select', () => {
    const shared = projectSharedRecap(recap, ['duration', 'records'], owner, 'LB');
    assert.equal(shared.durationSec, 3600);
    assert.equal(shared.records?.length, 1);
    for (const key of ['totalVolumeKg', 'completedSets', 'notes', 'progressionChanges']) {
      assert.equal(key in shared, false, `${key} leaked`);
    }
    assert.equal('sessionId' in shared, false);
    assert.equal(shared.weightUnit, 'LB');
    assert.deepEqual(shared.owner, owner);
  });
});

describe('WorkoutSessionShareService owner actions', () => {
  it('rejects an empty selection before touching the database', async () => {
    let reads = 0;
    const db = { workoutSession: { findFirst: async () => (reads += 1) } };
    await assert.rejects(
      service(db).create('user-1', 'session-1', ['bogus']),
      BadRequestException,
    );
    assert.equal(reads, 0);
  });

  it('only shares the owner’s completed sessions', async () => {
    const missing = { workoutSession: { findFirst: async () => null } };
    await assert.rejects(
      service(missing).create('user-1', 'session-1', ['duration']),
      NotFoundException,
    );
    const running = {
      workoutSession: { findFirst: async () => ({ status: 'IN_PROGRESS' }) },
    };
    await assert.rejects(
      service(running).create('user-1', 'session-1', ['duration']),
      BadRequestException,
    );
  });

  it('caps active links per session', async () => {
    const db = {
      workoutSession: { findFirst: async () => ({ status: 'COMPLETED' }) },
      sessionShare: { count: async () => 10 },
    };
    await assert.rejects(
      service(db).create('user-1', 'session-1', ['duration']),
      BadRequestException,
    );
  });

  it('stores normalized fields with a fresh token and serializes dates', async () => {
    let data: { token: string; fields: string[] } | undefined;
    const db = {
      workoutSession: { findFirst: async () => ({ status: 'COMPLETED' }) },
      sessionShare: {
        count: async () => 0,
        create: async (args: { data: { token: string; fields: string[] } }) => {
          data = args.data;
          return {
            id: 'share-1',
            sessionId: 'session-1',
            token: args.data.token,
            fields: args.data.fields,
            createdAt: new Date('2026-09-13T12:00:00.000Z'),
          };
        },
      },
    };
    const share = await service(db).create('user-1', 'session-1', [
      'records',
      'duration',
    ]);
    assert.deepEqual(data?.fields, ['duration', 'records']);
    assert.match(data!.token, /^[A-Za-z0-9_-]{24}$/);
    assert.equal(share.createdAt, '2026-09-13T12:00:00.000Z');
    assert.deepEqual(share.fields, ['duration', 'records']);
  });

  it('revokes only the owner’s active link', async () => {
    let where: Record<string, unknown> | undefined;
    const db = {
      sessionShare: {
        updateMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where;
          return { count: 0 };
        },
      },
    };
    await assert.rejects(
      service(db).revoke('user-1', 'session-1', 'share-1'),
      NotFoundException,
    );
    assert.deepEqual(where, {
      id: 'share-1',
      sessionId: 'session-1',
      userId: 'user-1',
      revokedAt: null,
    });
  });
});

describe('WorkoutSessionShareService public read', () => {
  it('treats malformed tokens as missing without a database read', async () => {
    let reads = 0;
    const db = { sessionShare: { findFirst: async () => (reads += 1) } };
    await assert.rejects(service(db).getShared('../etc'), NotFoundException);
    assert.equal(reads, 0);
  });

  it('only resolves active links', async () => {
    let where: Record<string, unknown> | undefined;
    const db = {
      sessionShare: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          where = args.where;
          return null;
        },
      },
    };
    await assert.rejects(service(db).getShared(token), NotFoundException);
    // TRUST-04 narrows the same query rather than adding a second check: a
    // hidden share stops resolving for whoever holds the link.
    assert.deepEqual(where, {
      token,
      revokedAt: null,
      moderationHiddenAt: null,
    });
  });

  it('returns only the selected recap fields with the owner identity and unit', async () => {
    const db = {
      sessionShare: {
        findFirst: async () => ({
          sessionId: 'session-1',
          userId: 'user-1',
          fields: ['volume', 'notes'],
          user: { ...owner, weightUnit: 'KG' },
        }),
      },
    };
    const shared = await service(db, {
      getSessionRecap: async (userId: string, sessionId: string) => {
        assert.equal(userId, 'user-1');
        assert.equal(sessionId, 'session-1');
        return recap;
      },
    }).getShared(token);
    assert.deepEqual(shared.fields, ['volume', 'notes']);
    assert.equal(shared.totalVolumeKg, 5400);
    assert.equal(shared.notes, 'Felt strong.');
    assert.equal('durationSec' in shared, false);
    assert.equal('records' in shared, false);
    assert.deepEqual(shared.owner, owner);
    assert.equal('email' in shared.owner, false);
  });

  it('reports a share whose session no longer has a recap as missing', async () => {
    const db = {
      sessionShare: {
        findFirst: async () => ({
          sessionId: 'session-1',
          userId: 'user-1',
          fields: ['duration'],
          user: { ...owner, weightUnit: 'KG' },
        }),
      },
    };
    await assert.rejects(
      service(db, {
        getSessionRecap: async () => {
          throw new BadRequestException('Session recap requires a completed session');
        },
      }).getShared(token),
      NotFoundException,
    );
  });
});
