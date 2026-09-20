import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import {
  blockPairWhere,
  blockedIdsWhere,
  otherPartyId,
} from '../src/users/member-blocks';
import { MemberBlocksService } from '../src/users/member-blocks.service';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from '../src/users/users.service';

describe('PROF-10 block relation', () => {
  it('matches a pair in either direction, because a block is symmetric', () => {
    // Enforcing one direction only would hide the blocked account from the
    // blocker while leaving the blocker visible to them.
    assert.deepEqual(blockPairWhere('a', 'b'), {
      OR: [
        { blockerId: 'a', blockedId: 'b' },
        { blockerId: 'b', blockedId: 'a' },
      ],
    });
    assert.deepEqual(blockedIdsWhere('a'), {
      OR: [{ blockerId: 'a' }, { blockedId: 'a' }],
    });
  });

  it('reads the other party whichever side of the block the viewer is on', () => {
    assert.equal(otherPartyId({ blockerId: 'a', blockedId: 'b' }, 'a'), 'b');
    assert.equal(otherPartyId({ blockerId: 'a', blockedId: 'b' }, 'b'), 'a');
  });
});

describe('MemberBlocksService', () => {
  const member = {
    id: 'them',
    username: 'them',
    name: 'Them',
    lastName: null,
    avatarUrl: null,
  };

  const makeDb = (overrides: Record<string, unknown> = {}) => {
    const calls: { follows: unknown[]; upserts: unknown[] } = {
      follows: [],
      upserts: [],
    };
    const db = {
      // TRUST-04: `hiddenFromViewer`/`isHiddenFromViewer` also ask `user`
      // for moderation hides, so the stub answers both delegates.
      user: {
        findFirst: async () => ({ id: 'them' }),
        count: async () => 0,
        findMany: async () => [],
      },
      userBlock: {
        count: async () => 0,
        upsert: (args: unknown) => {
          calls.upserts.push(args);
          return args;
        },
        deleteMany: async () => ({ count: 1 }),
        findMany: async () => [{ createdAt: new Date('2026-09-18T10:00:00.000Z'), blocked: member }],
      },
      userFollow: {
        deleteMany: (args: unknown) => {
          calls.follows.push(args);
          return args;
        },
      },
      $transaction: async (ops: unknown[]) => ops,
      ...overrides,
    } as unknown as DatabaseService;
    return { db, calls };
  };

  it('removes the follow in BOTH directions when a block is created', async () => {
    // A block that left them following you would leave them reading whatever
    // followers are allowed to read.
    const { db, calls } = makeDb();
    const result = await new MemberBlocksService(db).block('me', 'them');

    assert.deepEqual(calls.follows, [
      {
        where: {
          OR: [
            { followerId: 'me', followingId: 'them' },
            { followerId: 'them', followingId: 'me' },
          ],
        },
      },
    ]);
    assert.deepEqual(result.blocks, [
      { member, blockedAt: '2026-09-18T10:00:00.000Z' },
    ]);
  });

  it('refuses to block yourself', async () => {
    const { db } = makeDb({
      user: {
        findFirst: async () => ({ id: 'me' }),
        count: async () => 0,
        findMany: async () => [],
      },
    });
    await assert.rejects(
      () => new MemberBlocksService(db).block('me', 'me'),
      BadRequestException,
    );
  });

  it('reports every account hidden in either direction', async () => {
    const { db } = makeDb({
      userBlock: {
        findMany: async () => [
          { blockerId: 'me', blockedId: 'x' },
          { blockerId: 'y', blockedId: 'me' },
        ],
      },
    });
    assert.deepEqual(await new MemberBlocksService(db).blockedIds('me'), [
      'x',
      'y',
    ]);
  });

  it('unblocking restores nothing it removed', async () => {
    // Re-following silently would be a relationship neither of them asked for
    // a second time.
    const { db, calls } = makeDb();
    await new MemberBlocksService(db).unblock('me', 'them');
    assert.deepEqual(calls.follows, [], 'no follow is recreated');
  });
});

describe('PROF-10 enforcement on the profile read', () => {
  const storedProfile = {
    id: 'them',
    username: 'them',
    name: 'Them',
    lastName: null,
    avatarUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    bioVisibility: 'PUBLIC',
    locationVisibility: 'PUBLIC',
    trainingIdentityVisibility: 'PUBLIC',
    historyVisibility: 'PUBLIC',
    recordsVisibility: 'PUBLIC',
    routinesVisibility: 'PUBLIC',
    achievementsVisibility: 'PUBLIC',
    bodyMetricsVisibility: 'PUBLIC',
    moderationHiddenAt: null,
    _count: { followers: 0, following: 0 },
  };

  const dbWith = (blockCount: number, sensitive: () => void) =>
    ({
      user: {
        findFirst: async () => storedProfile,
        // TRUST-04 reads `count` for the hide; it must not be a sensitive
        // read, which is exactly what this test is checking.
        count: async () => 0,
        findUnique: async () => {
          sensitive();
          return null;
        },
      },
      userBlock: { count: async () => blockCount, findMany: async () => [] },
      userFollow: { findUnique: async () => null },
      workoutAnalyticsProjection: {
        findFirst: async () => {
          sensitive();
          return null;
        },
      },
      personalRecord: {
        findMany: async () => {
          sensitive();
          return [];
        },
      },
    }) as unknown as DatabaseService;

  it('answers 404 across a block, and reads nothing sensitive first', async () => {
    // A 403 would confirm both that the account exists and that a block is the
    // reason, which is something the blocker did not choose to disclose.
    let sensitiveReads = 0;
    const service = new UsersService(
      dbWith(1, () => {
        sensitiveReads += 1;
      }),
    );
    await assert.rejects(
      () => service.getPublicProfile('me', 'them'),
      NotFoundException,
    );
    assert.equal(sensitiveReads, 0, 'authorization precedes every read');
  });

  it('serves a fully public profile when there is no block', async () => {
    const service = new UsersService(
      dbWith(0, () => {
        /* allowed */
      }),
    );
    const profile = await service.getPublicProfile('me', 'them');
    assert.equal(profile.id, 'them');
    // The viewer is told only about their own action, never about theirs.
    assert.deepEqual(profile.moderation, { isBlocked: false });
  });

  it('refuses a follow across a block with the same 404', async () => {
    const service = new UsersService(dbWith(1, () => {}));
    await assert.rejects(
      () => service.followUser('me', 'them'),
      NotFoundException,
    );
  });

  it('excludes both parties of a block from search', async () => {
    let where: { id?: { notIn?: string[] } } = {};
    const db = {
      userBlock: {
        findMany: async () => [{ blockerId: 'x', blockedId: 'me' }],
        count: async () => 1,
      },
      user: {
        findMany: async (args: {
          where: { moderationHiddenAt?: unknown; id?: { notIn?: string[] } };
        }) => {
          // TRUST-04's hidden-accounts read shares this delegate; it is the
          // one carrying `moderationHiddenAt`, and nothing is hidden here.
          if (args.where.moderationHiddenAt) return [];
          where = args.where;
          return [];
        },
      },
    } as unknown as DatabaseService;
    await new UsersService(db).searchUsers('them', 'me');
    assert.deepEqual(where.id?.notIn, ['x']);
  });
});
