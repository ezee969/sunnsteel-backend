import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '../src/database/database.service';
import {
  decodeRelationshipCursor,
  encodeRelationshipCursor,
  rankFollowSuggestions,
  UserRelationshipsService,
} from '../src/users/user-relationships.service';

const member = (id: string) => ({
  id,
  username: `${id}_handle`,
  name: id.toUpperCase(),
  lastName: null,
  avatarUrl: null,
});

const followRow = (id: string, iso: string, key: 'follower' | 'following') => ({
  createdAt: new Date(iso),
  [key]: member(id),
});

describe('relationship cursors', () => {
  it('round-trips the relation date and member id', () => {
    const cursor = {
      createdAt: new Date('2026-09-01T10:00:00.123Z'),
      userId: 'user-9',
    };
    assert.deepEqual(
      decodeRelationshipCursor(encodeRelationshipCursor(cursor)),
      cursor,
    );
  });

  it('rejects values that are not a date and id pair', () => {
    for (const value of ['', 'bm90LWEtY3Vyc29y', 'fHVzZXItMQ']) {
      assert.throws(
        () => decodeRelationshipCursor(value),
        BadRequestException,
      );
    }
  });
});

describe('follow suggestion ranking', () => {
  it('puts follow-backs first, then network overlap, then id order', () => {
    const ranked = rankFollowSuggestions(
      ['fan-b', 'fan-a'],
      new Map([
        ['network-1', 1],
        ['network-3', 3],
        ['fan-a', 2],
      ]),
      10,
    );
    assert.deepEqual(ranked, [
      { id: 'fan-a', followsMe: true, mutualCount: 2 },
      { id: 'fan-b', followsMe: true, mutualCount: 0 },
      { id: 'network-3', followsMe: false, mutualCount: 3 },
      { id: 'network-1', followsMe: false, mutualCount: 1 },
    ]);
  });

  it('respects the limit after ranking', () => {
    const ranked = rankFollowSuggestions(
      [],
      new Map([
        ['a', 1],
        ['b', 5],
        ['c', 3],
      ]),
      2,
    );
    assert.deepEqual(
      ranked.map(candidate => candidate.id),
      ['b', 'c'],
    );
  });
});

describe('UserRelationshipsService lists', () => {
  it('pages followers newest first and marks the viewer relation', async () => {
    const calls: Array<{ where: Record<string, unknown> } & Record<string, unknown>> =
      [];
    const db = {
      user: {
        findFirst: async (args: { where: { OR: unknown[] } }) => {
          assert.deepEqual(args.where.OR, [
            { id: '@Owner_Handle' },
            { username: 'owner_handle' },
          ]);
          return { id: 'owner-1' };
        },
        findMany: async () => [],
      },
      userFollow: {
        findMany: async (
          args: { where: Record<string, unknown> } & Record<string, unknown>,
        ) => {
          calls.push(args);
          if (calls.length === 1) {
            return [
              followRow('c', '2026-09-03T00:00:00.000Z', 'follower'),
              followRow('b', '2026-09-02T00:00:00.000Z', 'follower'),
              followRow('a', '2026-09-01T00:00:00.000Z', 'follower'),
            ];
          }
          // Viewer state reads: the viewer follows `b`; `c` follows the viewer.
          if ('followingId' in args.where && 'followerId' in args.where) {
            return args.where.followerId === 'viewer-1'
              ? [{ followingId: 'b' }]
              : [{ followerId: 'c' }];
          }
          return [];
        },
      },
    // PROF-10/TRUST-04: this account blocks nobody, is blocked by nobody and
    // nothing is hidden by moderation. The reads are mocked explicitly rather
    // than defaulted, so a rule that should hide something can never pass by
    // being absent from a fixture.
    userBlock: { findMany: async () => [], count: async () => 0 },
    } as unknown as DatabaseService;
    const service = new UserRelationshipsService(db);

    const result = await service.list('viewer-1', '@Owner_Handle', 'followers', {
      limit: 2,
    });

    assert.deepEqual(calls[0].where, { followingId: 'owner-1' });
    assert.deepEqual(calls[0].orderBy, [
      { createdAt: 'desc' },
      { followerId: 'desc' },
    ]);
    assert.equal(calls[0].take, 3);
    assert.equal(result.kind, 'followers');
    assert.deepEqual(
      result.items.map(item => [item.id, item.isFollowedByMe, item.followsMe]),
      [
        ['c', false, true],
        ['b', true, false],
      ],
    );
    assert.equal('email' in result.items[0], false);
    assert.deepEqual(decodeRelationshipCursor(result.nextCursor!), {
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      userId: 'b',
    });
  });

  it('continues after the cursor with a stable date and id tie-break', async () => {
    let listArgs: { where: Record<string, unknown> } | undefined;
    const db = {
      user: { findFirst: async () => ({ id: 'owner-1' }), findMany: async () => [] },
      userFollow: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          listArgs ??= args;
          return [];
        },
      },
    // PROF-10/TRUST-04: this account blocks nobody, is blocked by nobody and
    // nothing is hidden by moderation. The reads are mocked explicitly rather
    // than defaulted, so a rule that should hide something can never pass by
    // being absent from a fixture.
    userBlock: { findMany: async () => [], count: async () => 0 },
    } as unknown as DatabaseService;
    const service = new UserRelationshipsService(db);
    const cursor = encodeRelationshipCursor({
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      userId: 'b',
    });

    const result = await service.list('viewer-1', 'owner_handle', 'following', {
      cursor,
    });

    assert.deepEqual(listArgs!.where, {
      followerId: 'owner-1',
      OR: [
        { createdAt: { lt: new Date('2026-09-02T00:00:00.000Z') } },
        {
          createdAt: new Date('2026-09-02T00:00:00.000Z'),
          followingId: { lt: 'b' },
        },
      ],
    });
    assert.deepEqual(result, { kind: 'following', items: [] });
  });

  it('limits mutuals to followers the viewer also follows', async () => {
    let listArgs: { where: Record<string, unknown> } | undefined;
    const db = {
      user: { findFirst: async () => ({ id: 'owner-1' }), findMany: async () => [] },
      userFollow: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          listArgs ??= args;
          return [];
        },
      },
    // PROF-10/TRUST-04: this account blocks nobody, is blocked by nobody and
    // nothing is hidden by moderation. The reads are mocked explicitly rather
    // than defaulted, so a rule that should hide something can never pass by
    // being absent from a fixture.
    userBlock: { findMany: async () => [], count: async () => 0 },
    } as unknown as DatabaseService;
    const service = new UserRelationshipsService(db);

    await service.list('viewer-1', 'owner_handle', 'mutuals');

    assert.deepEqual(listArgs!.where, {
      followingId: 'owner-1',
      follower: { followers: { some: { followerId: 'viewer-1' } } },
    });
  });

  it('returns 404 for an unknown profile before reading relations', async () => {
    let relationReads = 0;
    const db = {
      user: { findFirst: async () => null, findMany: async () => [] },
      userFollow: {
        findMany: async () => {
          relationReads += 1;
          return [];
        },
      },
    // PROF-10/TRUST-04: this account blocks nobody, is blocked by nobody and
    // nothing is hidden by moderation. The reads are mocked explicitly rather
    // than defaulted, so a rule that should hide something can never pass by
    // being absent from a fixture.
    userBlock: { findMany: async () => [], count: async () => 0 },
    } as unknown as DatabaseService;
    const service = new UserRelationshipsService(db);

    await assert.rejects(
      service.list('viewer-1', 'missing', 'followers'),
      NotFoundException,
    );
    assert.equal(relationReads, 0);
  });
});

describe('UserRelationshipsService suggestions', () => {
  it('requires discoverability for network accounts and ranks follow-backs first', async () => {
    let groupArgs: { where: Record<string, unknown> } | undefined;
    let fanArgs: { where: Record<string, unknown> } | undefined;
    const db = {
      userFollow: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          if (args.where.followerId === 'viewer-1') {
            return [{ followingId: 'friend-1' }, { followingId: 'friend-2' }];
          }
          fanArgs = args;
          return [{ followerId: 'fan-1' }];
        },
        groupBy: async (args: { where: Record<string, unknown> }) => {
          groupArgs = args;
          return [
            { followingId: 'network-1', _count: { followingId: 2 } },
            { followingId: 'fan-1', _count: { followingId: 1 } },
          ];
        },
      },
      user: {
        // TRUST-04's hidden-accounts read comes through the same delegate and
        // is the one carrying `moderationHiddenAt`; nothing is hidden here.
        findMany: async (args: { where?: Record<string, unknown> }) =>
          args.where?.moderationHiddenAt
            ? []
            : [member('network-1'), member('fan-1')],
      },
    // PROF-10/TRUST-04: this account blocks nobody, is blocked by nobody and
    // nothing is hidden by moderation. The reads are mocked explicitly rather
    // than defaulted, so a rule that should hide something can never pass by
    // being absent from a fixture.
    userBlock: { findMany: async () => [], count: async () => 0 },
    } as unknown as DatabaseService;
    const service = new UserRelationshipsService(db);

    const result = await service.suggestions('viewer-1');

    assert.deepEqual(groupArgs!.where, {
      followerId: { in: ['friend-1', 'friend-2'] },
      followingId: { notIn: ['friend-1', 'friend-2', 'viewer-1'] },
      following: {
        OR: [{ discoverableByName: true }, { discoverableByUsername: true }],
      },
    });
    assert.deepEqual(fanArgs!.where, {
      followingId: 'viewer-1',
      followerId: { notIn: ['friend-1', 'friend-2', 'viewer-1'] },
    });
    assert.deepEqual(
      result.items.map(item => [
        item.id,
        item.reason,
        item.mutualCount,
        item.followsMe,
        item.isFollowedByMe,
      ]),
      [
        ['fan-1', 'FOLLOWS_YOU', 1, true, false],
        ['network-1', 'FOLLOWED_BY_PEOPLE_YOU_FOLLOW', 2, false, false],
      ],
    );
  });

  it('skips the network read for a viewer who follows nobody', async () => {
    let groupReads = 0;
    const db = {
      userFollow: {
        findMany: async () => [],
        groupBy: async () => {
          groupReads += 1;
          return [];
        },
      },
      user: { findMany: async () => [] },
    // PROF-10/TRUST-04: this account blocks nobody, is blocked by nobody and
    // nothing is hidden by moderation. The reads are mocked explicitly rather
    // than defaulted, so a rule that should hide something can never pass by
    // being absent from a fixture.
    userBlock: { findMany: async () => [], count: async () => 0 },
    } as unknown as DatabaseService;
    const service = new UserRelationshipsService(db);

    assert.deepEqual(await service.suggestions('viewer-1'), { items: [] });
    assert.equal(groupReads, 0);
  });
});
