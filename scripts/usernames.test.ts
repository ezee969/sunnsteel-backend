import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DatabaseService } from '../src/database/database.service';
import {
  createInitialUsername,
  getUsernameValidationError,
  normalizeUsername,
} from '../src/users/username';
import { UsersService } from '../src/users/users.service';

const profileRecord = {
  timeZone: 'UTC',
  id: 'user-1',
  email: 'owner@example.test',
  username: 'new_handle',
  name: 'Owner',
  lastName: null,
  avatarUrl: null,
  age: null,
  sex: null,
  weight: null,
  height: null,
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

describe('username rules', () => {
  it('normalizes a pasted handle and validates the shared format', () => {
    assert.equal(normalizeUsername('  @Strong_Lifter  '), 'strong_lifter');
    assert.equal(getUsernameValidationError('strong_lifter'), null);
    assert.equal(getUsernameValidationError('ab'), 'INVALID_FORMAT');
    assert.equal(getUsernameValidationError('_strong'), 'INVALID_FORMAT');
  });

  it('rejects route and product names reserved by the shared contract', () => {
    assert.equal(getUsernameValidationError('settings'), 'RESERVED');
    assert.equal(getUsernameValidationError('@Sunnsteel'), 'RESERVED');
  });

  it('creates deterministic, valid initial handles without exposing email', () => {
    const username = createInitialUsername('Éze Olivero', 'supabase-user-id');
    assert.equal(
      username,
      createInitialUsername('Éze Olivero', 'supabase-user-id'),
    );
    assert.match(username, /^eze_olivero_[a-f0-9]{12}$/);
    assert.equal(getUsernameValidationError(username), null);
    assert.equal(username.includes('example.com'), false);
  });
});

describe('UsersService usernames', () => {
  it('normalizes username updates at the persistence boundary', async () => {
    let updateArgs: unknown;
    const db = {
      user: {
        update: async (args: unknown) => {
          updateArgs = args;
          return profileRecord;
        },
      },
    } as unknown as DatabaseService;
    const service = new UsersService(db);

    const result = await service.updateProfile('owner@example.test', {
      username: '@New_Handle',
    });

    assert.equal(
      (updateArgs as { data: { username: string } }).data.username,
      'new_handle',
    );
    assert.equal(result.username, 'new_handle');
    assert.equal(result.createdAt, '2026-01-01T00:00:00.000Z');
  });

  it('rejects reserved handles before writing and maps unique conflicts', async () => {
    const db = {
      user: {
        update: async () => {
          throw new Prisma.PrismaClientKnownRequestError('duplicate username', {
            code: 'P2002',
            clientVersion: '6.19.2',
            meta: { target: ['username'] },
          });
        },
      },
    } as unknown as DatabaseService;
    const service = new UsersService(db);

    await assert.rejects(
      service.updateProfile('owner@example.test', { username: 'settings' }),
      BadRequestException,
    );
    await assert.rejects(
      service.updateProfile('owner@example.test', { username: 'taken_name' }),
      ConflictException,
    );
  });

  it('searches @handles without selecting email addresses', async () => {
    let findManyArgs: unknown;
    const db = {
      user: {
        findMany: async (args: unknown) => {
          findManyArgs = args;
          return [
            {
              id: 'user-2',
              username: 'atlas_lifts',
              name: 'Atlas',
              lastName: null,
              avatarUrl: null,
            },
          ];
        },
      },
    } as unknown as DatabaseService;
    const service = new UsersService(db);

    const result = await service.searchUsers('@Atlas', 'user-1', 5);
    const args = findManyArgs as {
      where: { id: { not: string }; OR: unknown[] };
      select: Record<string, boolean>;
    };

    assert.equal(args.where.id.not, 'user-1');
    assert.deepEqual(args.where.OR, [
      { username: { contains: 'atlas', mode: 'insensitive' } },
    ]);
    assert.equal('email' in args.select, false);
    assert.equal(result[0].username, 'atlas_lifts');
  });

  it('resolves a public profile by handle while follow state uses its id', async () => {
    let followLookup: unknown;
    const db = {
      user: {
        findFirst: async () => profileRecord,
      },
      userFollow: {
        findUnique: async (args: unknown) => {
          followLookup = args;
          return { followerId: 'viewer-1' };
        },
      },
    } as unknown as DatabaseService;
    const service = new UsersService(db);

    const result = await service.getPublicProfile('viewer-1', '@New_Handle');

    assert.deepEqual(
      (
        followLookup as {
          where: {
            followerId_followingId: { followerId: string; followingId: string };
          };
        }
      ).where.followerId_followingId,
      { followerId: 'viewer-1', followingId: 'user-1' },
    );
    assert.equal(result.username, 'new_handle');
    assert.equal(result.isFollowedByMe, true);
  });
});
