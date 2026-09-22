import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProfilePrivacySettings } from '@sunsteel/contracts';
import { resolveProfileViewerAccess } from '../src/users/profile-privacy';
import {
  NO_TRAINING_PARTNER_PERMISSIONS,
  trainingPartnerPairKey,
} from '../src/users/training-partner-access';
import { mapTrainingPartnership } from '../src/users/training-partners.service';

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
