import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseService } from '../src/database/database.service';
import {
  canViewProfileSection,
  resolveProfileViewerAccess,
} from '../src/users/profile-privacy';
import { UsersService } from '../src/users/users.service';

const privateSettings = {
  workoutHistory: 'PRIVATE',
  records: 'PRIVATE',
  routines: 'PRIVATE',
  achievements: 'PRIVATE',
  bodyMetrics: 'PRIVATE',
} as const;

const storedProfile = {
  timeZone: 'UTC',
  id: 'owner-1',
  email: 'owner@example.test',
  username: 'owner_handle',
  name: 'Owner',
  lastName: null,
  avatarUrl: null,
  age: 30,
  sex: 'MALE' as const,
  weight: 80,
  height: 180,
  weightUnit: 'KG' as const,
  historyVisibility: 'PRIVATE' as const,
  recordsVisibility: 'PRIVATE' as const,
  routinesVisibility: 'PRIVATE' as const,
  achievementsVisibility: 'PRIVATE' as const,
  bodyMetricsVisibility: 'PRIVATE' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  _count: { followers: 2, following: 3 },
};

describe('profile privacy rules', () => {
  it('grants owners every section and applies public/follower/private rules', () => {
    assert.equal(
      canViewProfileSection('PRIVATE', {
        isOwner: true,
        isFollower: false,
      }),
      true,
    );
    assert.equal(
      canViewProfileSection('PUBLIC', {
        isOwner: false,
        isFollower: false,
      }),
      true,
    );
    assert.equal(
      canViewProfileSection('FOLLOWERS', {
        isOwner: false,
        isFollower: true,
      }),
      true,
    );
    assert.equal(
      canViewProfileSection('FOLLOWERS', {
        isOwner: false,
        isFollower: false,
      }),
      false,
    );
    assert.equal(
      canViewProfileSection('PRIVATE', {
        isOwner: false,
        isFollower: true,
      }),
      false,
    );
  });

  it('resolves every domain independently', () => {
    assert.deepEqual(
      resolveProfileViewerAccess(
        {
          workoutHistory: 'PUBLIC',
          records: 'FOLLOWERS',
          routines: 'PRIVATE',
          achievements: 'PUBLIC',
          bodyMetrics: 'PRIVATE',
        },
        { isOwner: false, isFollower: true },
      ),
      {
        workoutHistory: true,
        records: true,
        routines: false,
        achievements: true,
        bodyMetrics: false,
      },
    );
  });
});

describe('UsersService privacy boundary', () => {
  it('stores the complete privacy replacement and returns the private profile', async () => {
    let updateArgs: unknown;
    const db = {
      user: {
        update: async (args: unknown) => {
          updateArgs = args;
          return {
            ...storedProfile,
            historyVisibility: 'PUBLIC',
            recordsVisibility: 'FOLLOWERS',
          };
        },
      },
    } as unknown as DatabaseService;
    const service = new UsersService(db);

    const result = await service.updateProfilePrivacy('owner@example.test', {
      workoutHistory: 'PUBLIC',
      records: 'FOLLOWERS',
      routines: 'PRIVATE',
      achievements: 'PRIVATE',
      bodyMetrics: 'PRIVATE',
    });

    assert.deepEqual(
      (updateArgs as { data: Record<string, string> }).data,
      {
        historyVisibility: 'PUBLIC',
        recordsVisibility: 'FOLLOWERS',
        routinesVisibility: 'PRIVATE',
        achievementsVisibility: 'PRIVATE',
        bodyMetricsVisibility: 'PRIVATE',
      },
    );
    assert.deepEqual(result.privacySettings, {
      ...privateSettings,
      workoutHistory: 'PUBLIC',
      records: 'FOLLOWERS',
    });
    assert.equal(result.email, 'owner@example.test');
  });

  it('does not even query sensitive sections when the viewer lacks access', async () => {
    let sensitiveReads = 0;
    const db = {
      user: {
        findFirst: async () => storedProfile,
        findUnique: async () => {
          sensitiveReads += 1;
          return storedProfile;
        },
      },
      userFollow: { findUnique: async () => null },
      workoutAnalyticsProjection: {
        findFirst: async () => {
          sensitiveReads += 1;
          return null;
        },
      },
      personalRecord: {
        findMany: async () => {
          sensitiveReads += 1;
          return [];
        },
      },
    } as unknown as DatabaseService;
    const service = new UsersService(db);

    const result = await service.getPublicProfile('viewer-1', 'owner_handle');

    assert.equal(sensitiveReads, 0);
    assert.deepEqual(result.viewerAccess, {
      workoutHistory: false,
      records: false,
      routines: false,
      achievements: false,
      bodyMetrics: false,
    });
    assert.equal('trainingSummary' in result, false);
    assert.equal('personalRecords' in result, false);
    assert.equal('bodyMetrics' in result, false);
    assert.equal('email' in result, false);
  });

  it('returns only sections allowed to a follower and keeps dates serialized', async () => {
    const db = {
      user: {
        findFirst: async () => ({
          ...storedProfile,
          historyVisibility: 'FOLLOWERS',
          recordsVisibility: 'PUBLIC',
          routinesVisibility: 'PRIVATE',
          achievementsVisibility: 'FOLLOWERS',
          bodyMetricsVisibility: 'FOLLOWERS',
        }),
        findUnique: async () => ({
          age: 30,
          sex: 'MALE',
          weight: 80,
          height: 180,
        }),
      },
      userFollow: {
        findUnique: async () => ({ followerId: 'viewer-1' }),
      },
      workoutAnalyticsProjection: {
        findFirst: async () => ({
          completedSessions: 12,
          totalVolumeKg: 1234,
          currentRun: 3,
          bestRun: 6,
        }),
      },
      personalRecord: {
        findMany: async () => [
          {
            exerciseId: 'exercise-1',
            exerciseName: 'Bench Press',
            weight: 100,
            reps: 5,
            estimated1rm: 116.7,
            achievedAt: new Date('2026-02-01T12:00:00.000Z'),
          },
        ],
      },
    } as unknown as DatabaseService;
    const service = new UsersService(db);

    const result = await service.getPublicProfile('viewer-1', 'owner_handle');

    assert.deepEqual(result.viewerAccess, {
      workoutHistory: true,
      records: true,
      routines: false,
      achievements: true,
      bodyMetrics: true,
    });
    assert.deepEqual(result.trainingSummary, {
      completedWorkouts: 12,
      totalVolumeKg: 1234,
      currentStreakDays: 3,
      bestStreakDays: 6,
    });
    assert.equal(
      result.personalRecords?.[0].achievedAt,
      '2026-02-01T12:00:00.000Z',
    );
    assert.deepEqual(result.bodyMetrics, {
      age: 30,
      sex: 'MALE',
      weightKg: 80,
      heightCm: 180,
    });
  });
});
