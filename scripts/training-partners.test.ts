import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProfilePrivacySettings } from '@sunsteel/contracts';
import { TRAINING_PARTNER_ENCOURAGEMENTS_PER_24_HOURS_MAX } from '@sunsteel/contracts';
import { DatabaseService } from '../src/database/database.service';
import { resolveProfileViewerAccess } from '../src/users/profile-privacy';
import {
  NO_TRAINING_PARTNER_PERMISSIONS,
  trainingPartnerPairKey,
} from '../src/users/training-partner-access';
import {
  mapTrainingPartnership,
  TrainingPartnersService,
} from '../src/users/training-partners.service';

describe('SOC-08 training partnership rules', () => {
  it('uses one canonical key for a pair in either direction', () => {
    assert.equal(trainingPartnerPairKey('a', 'b'), 'a:b');
    assert.equal(trainingPartnerPairKey('b', 'a'), 'a:b');
  });

  it('adds only the explicitly granted follower-scoped profile sections', () => {
    const settings: ProfilePrivacySettings = {
      biography: 'FOLLOWERS',
      location: 'FOLLOWERS',
      trainingIdentity: 'FOLLOWERS',
      workoutHistory: 'FOLLOWERS',
      records: 'FOLLOWERS',
      routines: 'FOLLOWERS',
      achievements: 'FOLLOWERS',
      bodyMetrics: 'FOLLOWERS',
    };
    assert.deepEqual(
      resolveProfileViewerAccess(settings, {
        isOwner: false,
        isFollower: false,
        partnerProgress: true,
        partnerRoutines: true,
      }),
      {
        biography: false,
        location: false,
        trainingIdentity: false,
        workoutHistory: true,
        records: true,
        routines: true,
        achievements: true,
        bodyMetrics: false,
      },
    );
  });

  it('never widens a PRIVATE section', () => {
    const settings = Object.fromEntries(
      [
        'biography',
        'location',
        'trainingIdentity',
        'workoutHistory',
        'records',
        'routines',
        'achievements',
        'bodyMetrics',
      ].map((key) => [key, 'PRIVATE']),
    ) as unknown as ProfilePrivacySettings;
    const access = resolveProfileViewerAccess(settings, {
      isOwner: false,
      isFollower: false,
      partnerProgress: true,
      partnerRoutines: true,
    });
    assert.equal(Object.values(access).some(Boolean), false);
  });

  it('maps the other member and both independent grants for either side', () => {
    const row = {
      id: 'partnership',
      requesterId: 'requester',
      recipientId: 'recipient',
      status: 'ACTIVE',
      createdAt: new Date('2026-09-22T10:00:00.000Z'),
      acceptedAt: new Date('2026-09-22T11:00:00.000Z'),
      requester: {
        id: 'requester',
        username: 'requester',
        name: 'Requester',
        lastName: null,
        avatarUrl: null,
      },
      recipient: {
        id: 'recipient',
        username: 'recipient',
        name: 'Recipient',
        lastName: null,
        avatarUrl: null,
      },
      grants: [
        {
          grantorId: 'requester',
          ...NO_TRAINING_PARTNER_PERMISSIONS,
          progress: true,
        },
        {
          grantorId: 'recipient',
          ...NO_TRAINING_PARTNER_PERMISSIONS,
          schedule: true,
        },
      ],
    } as any;

    const requester = mapTrainingPartnership(row, 'requester');
    assert.equal(requester.member.id, 'recipient');
    assert.equal(requester.requestedByMe, true);
    assert.equal(requester.permissionsGrantedByMe.progress, true);
    assert.equal(requester.permissionsGrantedToMe.schedule, true);

    const recipient = mapTrainingPartnership(row, 'recipient');
    assert.equal(recipient.member.id, 'requester');
    assert.equal(recipient.requestedByMe, false);
    assert.equal(recipient.permissionsGrantedByMe.schedule, true);
    assert.equal(recipient.permissionsGrantedToMe.progress, true);
  });
});

const encouragementDb = ({
  allowed = true,
  sent = 0,
}: {
  allowed?: boolean;
  sent?: number;
}) => {
  const writes: any[] = [];
  const tx = {
    trainingPartnership: {
      findFirst: async () => ({
        requesterId: 'sender',
        recipientId: 'recipient',
        grants: allowed ? [{ grantorId: 'recipient' }] : [],
      }),
    },
    userBlock: { count: async () => 0 },
    user: { count: async () => 0 },
    notification: {
      count: async () => sent,
      create: async ({ data }: any) => {
        writes.push(data);
        return { id: 'notification', createdAt: data.createdAt };
      },
    },
  };
  const db = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
  } as unknown as DatabaseService;
  return { service: new TrainingPartnersService(db), writes };
};

describe('SOC-09 partner encouragement', () => {
  const now = new Date('2026-09-22T18:00:00.000Z');

  it('writes one fixed prompt to the recipient notification centre', async () => {
    const { service, writes } = encouragementDb({});
    assert.deepEqual(
      await service.encourage('sender', 'partnership', 'GOOD_WORK', now),
      {
        notificationId: 'notification',
        sentAt: now.toISOString(),
      },
    );
    assert.equal(writes.length, 1);
    assert.deepEqual(
      {
        userId: writes[0].userId,
        actorId: writes[0].actorId,
        kind: writes[0].kind,
        payload: writes[0].payload,
      },
      {
        userId: 'recipient',
        actorId: 'sender',
        kind: 'TRAINING_PARTNER_ENCOURAGEMENT',
        payload: { encouragementKind: 'GOOD_WORK' },
      },
    );
  });

  it('answers not found when the recipient did not grant encouragement', async () => {
    const { service } = encouragementDb({ allowed: false });
    await assert.rejects(
      service.encourage('sender', 'partnership', 'KEEP_GOING', now),
      (error: any) => error?.status === 404,
    );
  });

  it('enforces the rolling per-pair budget before writing', async () => {
    const { service, writes } = encouragementDb({
      sent: TRAINING_PARTNER_ENCOURAGEMENTS_PER_24_HOURS_MAX,
    });
    await assert.rejects(
      service.encourage('sender', 'partnership', 'READY_TO_TRAIN', now),
      (error: any) => error?.status === 429,
    );
    assert.equal(writes.length, 0);
  });
});
