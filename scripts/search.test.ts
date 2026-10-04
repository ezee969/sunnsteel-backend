import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeSearchQuery,
  SEARCH_PAGE_SIZE,
  SEARCH_PAGE_SIZE_MAX,
  SEARCH_QUERY_MAX_LENGTH,
} from '@sunsteel/contracts';
import type { Prisma } from '@prisma/client';
import { canViewRoutine } from '../src/routines/routine-visibility';
import {
  afterUpdatedAt,
  containsPattern,
  decodeMemberCursor,
  decodeTimeCursor,
  encodeMemberCursor,
  encodeTimeCursor,
  readableSharedRoutineWhere,
  searchPageSize,
} from '../src/search/search-rules';
import { memberSearchBranches } from '../src/users/member-search';

describe('NAV-01 query normalization', () => {
  it('trims, collapses whitespace and refuses anything under two characters', () => {
    assert.equal(normalizeSearchQuery('  bench   press '), 'bench press');
    assert.equal(normalizeSearchQuery(' a '), null);
    assert.equal(normalizeSearchQuery(''), null);
    assert.equal(normalizeSearchQuery(undefined), null);
  });

  it('cuts a long query to the maximum', () => {
    const query = normalizeSearchQuery('x'.repeat(SEARCH_QUERY_MAX_LENGTH + 40));
    assert.equal(query?.length, SEARCH_QUERY_MAX_LENGTH);
  });
});

describe('NAV-01 member search follows the PROF-09 discovery switches', () => {
  it('matches a name only where name discovery is on, and a handle only where username discovery is', () => {
    const branches = memberSearchBranches('Ana');
    assert.deepEqual(branches, [
      {
        discoverableByName: true,
        OR: [
          { name: { contains: 'Ana', mode: 'insensitive' } },
          { lastName: { contains: 'Ana', mode: 'insensitive' } },
        ],
      },
      {
        discoverableByUsername: true,
        username: { contains: 'ana', mode: 'insensitive' },
      },
    ]);
  });

  it('asks only for a handle when the query starts with @', () => {
    assert.deepEqual(memberSearchBranches('@Ana.B'), [
      {
        discoverableByUsername: true,
        username: { contains: 'ana.b', mode: 'insensitive' },
      },
    ]);
  });

  it("takes % and _ literally, which Prisma's contains does not", () => {
    assert.deepEqual(memberSearchBranches('@a_b'), [
      {
        discoverableByUsername: true,
        username: { contains: 'a\\_b', mode: 'insensitive' },
      },
    ]);
    const [byName] = memberSearchBranches('50%') ?? [];
    assert.deepEqual(byName, {
      discoverableByName: true,
      OR: [
        { name: { contains: '50\\%', mode: 'insensitive' } },
        { lastName: { contains: '50\\%', mode: 'insensitive' } },
      ],
    });
  });

  it('searches for nothing rather than everyone when there is nothing to match', () => {
    assert.equal(memberSearchBranches('   '), null);
    assert.equal(memberSearchBranches('@'), null);
  });
});

describe('NAV-01 rules', () => {
  it('takes a member query literally inside a LIKE pattern', () => {
    assert.equal(containsPattern('100%'), '%100\\%%');
    assert.equal(containsPattern('leg_day'), '%leg\\_day%');
    assert.equal(containsPattern('a\\b'), '%a\\\\b%');
  });

  it('pages by the contract sizes', () => {
    assert.equal(searchPageSize(), SEARCH_PAGE_SIZE);
    assert.equal(searchPageSize(0), 1);
    assert.equal(searchPageSize(500), SEARCH_PAGE_SIZE_MAX);
  });

  it('round-trips its cursors and refuses another category\'s', () => {
    assert.equal(decodeMemberCursor(encodeMemberCursor('ana')), 'ana');
    const at = new Date('2026-10-03T10:00:00.000Z');
    const routine = encodeTimeCursor('r', at, 'routine-1');
    assert.deepEqual(decodeTimeCursor('r', routine), { at, id: 'routine-1' });
    assert.throws(() => decodeTimeCursor('w', routine));
    assert.throws(() => decodeMemberCursor(routine));
    assert.throws(() => decodeTimeCursor('w', 'not-a-cursor'));
    assert.equal(decodeTimeCursor('w', undefined), null);
  });

  it('continues newest first after a cursor, ties broken by id', () => {
    const at = new Date('2026-10-03T10:00:00.000Z');
    assert.deepEqual(afterUpdatedAt({ at, id: 'b' }), {
      OR: [{ updatedAt: { lt: at } }, { updatedAt: at, id: { lt: 'b' } }],
    });
    assert.deepEqual(afterUpdatedAt(null), {});
  });
});

/**
 * The database filter must find exactly the routines `canViewRoutine` lets a
 * non-owner read, or search would show something discovery hides (or the
 * reverse). Every combination of the account rule, the routine's own
 * visibility, following and a moderator's hide is evaluated both ways.
 */
describe('NAV-01 shared routines are ROUT-07 discovery candidates', () => {
  const accountRules = ['PUBLIC', 'FOLLOWERS', 'PRIVATE'] as const;
  const routineRules = ['PUBLIC', 'FOLLOWERS', 'PRIVATE'] as const;

  type Row = {
    userId: string;
    visibility: string;
    moderationHiddenAt: Date | null;
    user: { routinesVisibility: string };
  };

  const matches = (where: Prisma.RoutineWhereInput, row: Row): boolean => {
    if ('moderationHiddenAt' in where && where.moderationHiddenAt === null) {
      if (row.moderationHiddenAt !== null) return false;
    }
    const branches = (where.OR ?? []) as Prisma.RoutineWhereInput[];
    return branches.some((branch) => {
      const userId = branch.userId as { in: string[] } | undefined;
      if (userId && !userId.in.includes(row.userId)) return false;
      const visibility = branch.visibility as string | { in: string[] };
      const rule = (branch.user as { routinesVisibility: string | { in: string[] } })
        .routinesVisibility;
      const allows = (filter: string | { in: string[] }, value: string) =>
        typeof filter === 'string' ? filter === value : filter.in.includes(value);
      return (
        allows(visibility, row.visibility) &&
        allows(rule, row.user.routinesVisibility)
      );
    });
  };

  for (const account of accountRules) {
    for (const own of routineRules) {
      for (const isFollower of [false, true]) {
        for (const hidden of [false, true]) {
          it(`account ${account}, routine ${own}, follower ${isFollower}, hidden ${hidden}`, () => {
            const row: Row = {
              userId: 'owner',
              visibility: own,
              moderationHiddenAt: hidden ? new Date() : null,
              user: { routinesVisibility: account },
            };
            const where = readableSharedRoutineWhere(isFollower ? ['owner'] : []);
            assert.equal(
              matches(where, row),
              canViewRoutine(account, own, { isOwner: false, isFollower }, row),
            );
          });
        }
      }
    }
  }
});
