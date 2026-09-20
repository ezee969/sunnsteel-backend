import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MODERATION_ACTION_KINDS,
  PROFILE_VISIBILITY_VALUES,
  REPORT_STATUSES,
  ROUTINE_VISIBILITY_VALUES,
  type ModerationActionKind,
  type ProfileVisibility,
  type ReportStatus,
  type RoutineVisibility,
} from '@sunsteel/contracts';
import { canViewRoutine } from '../src/routines/routine-visibility';
import {
  canAct,
  decodeQueueCursor,
  encodeQueueCursor,
  queuePageSize,
  resolvesReport,
  statusAfter,
} from '../src/moderation/moderation-rules';
import {
  hiddenFromViewer,
  isHiddenFromViewer,
  type MemberVisibilityDb,
} from '../src/users/member-blocks';

const KINDS = MODERATION_ACTION_KINDS as readonly ModerationActionKind[];
const STATUSES = REPORT_STATUSES as readonly ReportStatus[];

describe('TRUST-04 review state', () => {
  it('closes a report only when it was dismissed or acted on', () => {
    assert.equal(resolvesReport('DISMISS_REPORT'), true);
    assert.equal(resolvesReport('HIDE_SUBJECT'), true);
    // Reading is not a decision, and a restore takes one back.
    assert.equal(resolvesReport('VIEW_SUBJECT'), false);
    assert.equal(resolvesReport('RESTORE_SUBJECT'), false);
  });

  it('never changes a report because somebody read its subject', () => {
    for (const status of STATUSES) {
      assert.equal(statusAfter('VIEW_SUBJECT', status), status);
    }
  });

  it('reopens a report when the hide that handled it is undone', () => {
    // Otherwise a restored subject would leave a report marked ACTIONED with
    // no action standing, which is the one state the queue must not have.
    assert.equal(statusAfter('HIDE_SUBJECT', 'OPEN'), 'ACTIONED');
    assert.equal(statusAfter('RESTORE_SUBJECT', 'ACTIONED'), 'OPEN');
    assert.equal(statusAfter('DISMISS_REPORT', 'OPEN'), 'DISMISSED');
  });

  it('refuses to hide or restore what is not there, but still dismisses it', () => {
    const gone = { isMissing: true, isHidden: false };
    assert.equal(canAct('DISMISS_REPORT', gone).allowed, true);
    assert.equal(canAct('HIDE_SUBJECT', gone).allowed, false);
    assert.equal(canAct('RESTORE_SUBJECT', gone).allowed, false);
  });

  it('refuses a hide that is already in force and a restore of nothing', () => {
    const hidden = { isMissing: false, isHidden: true };
    const visible = { isMissing: false, isHidden: false };
    assert.equal(canAct('HIDE_SUBJECT', hidden).allowed, false);
    assert.equal(canAct('HIDE_SUBJECT', visible).allowed, true);
    assert.equal(canAct('RESTORE_SUBJECT', visible).allowed, false);
    assert.equal(canAct('RESTORE_SUBJECT', hidden).allowed, true);
  });

  it('has an outcome for every action kind', () => {
    for (const kind of KINDS) {
      assert.equal(typeof statusAfter(kind, 'OPEN'), 'string');
      assert.equal(typeof resolvesReport(kind), 'boolean');
    }
  });
});

describe('TRUST-04 queue cursor', () => {
  it('round-trips the instant and the id', () => {
    // Reports about one subject arrive in bursts and share a second, so the
    // instant alone would drop or repeat rows at a page boundary.
    const at = new Date('2026-09-20T10:11:12.345Z');
    const decoded = decodeQueueCursor(encodeQueueCursor({ at, id: 'r-7' }));
    assert.equal(decoded?.at.toISOString(), at.toISOString());
    assert.equal(decoded?.id, 'r-7');
  });

  it('treats a malformed cursor as no cursor rather than throwing', () => {
    assert.equal(decodeQueueCursor(undefined), null);
    assert.equal(decodeQueueCursor(''), null);
    assert.equal(decodeQueueCursor('bm90LWEtY3Vyc29y'), null);
  });

  it('clamps the page size to the contract maximum', () => {
    assert.equal(queuePageSize(undefined), 20);
    assert.equal(queuePageSize(0), 20);
    assert.equal(queuePageSize(5), 5);
    assert.equal(queuePageSize(500), 20);
  });
});

describe('TRUST-04 hiding narrows the shipped routine rule', () => {
  it('refuses a hidden routine to every viewer but its owner', () => {
    // The hide is asked before either ROUT-04 rule, so no later change to a
    // visibility setting can widen it back.
    for (const account of PROFILE_VISIBILITY_VALUES as readonly ProfileVisibility[]) {
      for (const visibility of ROUTINE_VISIBILITY_VALUES as readonly RoutineVisibility[]) {
        for (const isFollower of [true, false]) {
          assert.equal(
            canViewRoutine(
              account,
              visibility,
              { isOwner: false, isFollower },
              { moderationHiddenAt: new Date() },
            ),
            false,
          );
          assert.equal(
            canViewRoutine(
              account,
              visibility,
              { isOwner: true, isFollower },
              { moderationHiddenAt: new Date() },
            ),
            true,
          );
        }
      }
    }
  });

  it('changes nothing about a routine that is not hidden', () => {
    // The whole nine-combination table ROUT-04 already owns must be
    // untouched by the new argument.
    for (const account of PROFILE_VISIBILITY_VALUES as readonly ProfileVisibility[]) {
      for (const visibility of ROUTINE_VISIBILITY_VALUES as readonly RoutineVisibility[]) {
        for (const isFollower of [true, false]) {
          const context = { isOwner: false, isFollower };
          const expected =
            visibility !== 'PRIVATE' &&
            (account === 'PUBLIC' || (account === 'FOLLOWERS' && isFollower)) &&
            (visibility === 'PUBLIC' ||
              (visibility === 'FOLLOWERS' && isFollower));
          assert.equal(
            canViewRoutine(account, visibility, context, {
              moderationHiddenAt: null,
            }),
            expected,
          );
        }
      }
    }
  });
});

/** A stand-in for the two model delegates the visibility helpers touch. */
function visibilityDb(options: {
  blocks?: { blockerId: string; blockedId: string }[];
  hidden?: string[];
}): MemberVisibilityDb {
  const blocks = options.blocks ?? [];
  const hidden = new Set(options.hidden ?? []);
  const matchesPair = (
    row: { blockerId: string; blockedId: string },
    where: any,
  ): boolean =>
    (where.OR as any[]).some(
      (clause) =>
        (clause.blockerId === undefined ||
          clause.blockerId === row.blockerId) &&
        (clause.blockedId === undefined || clause.blockedId === row.blockedId),
    );
  return {
    userBlock: {
      findMany: async ({ where }: any) =>
        blocks.filter((row) => matchesPair(row, where)),
      count: async ({ where }: any) =>
        blocks.filter((row) => matchesPair(row, where)).length,
    },
    user: {
      findMany: async ({ where }: any) =>
        [...hidden]
          .filter((id) => id !== where.id?.not)
          .map((id) => ({ id })),
      count: async ({ where }: any) => (hidden.has(where.id) ? 1 : 0),
    },
  } as unknown as MemberVisibilityDb;
}

describe('TRUST-04 hidden members leave the reads a block already leaves', () => {
  it('answers blocks and hides together, so a read cannot honour only one', async () => {
    const both = visibilityDb({
      blocks: [{ blockerId: 'viewer', blockedId: 'blocked' }],
      hidden: ['hidden'],
    });
    assert.deepEqual(
      [...(await hiddenFromViewer(both, 'viewer'))].sort(),
      ['blocked', 'hidden'],
    );

    // A block read from the other side still removes the other party.
    const reversed = visibilityDb({
      blocks: [{ blockerId: 'other', blockedId: 'viewer' }],
    });
    assert.deepEqual(await hiddenFromViewer(reversed, 'viewer'), ['other']);
  });

  it('never hides a hidden account from itself', async () => {
    // The hide takes the account away from everyone else; it does not take
    // the account away from its owner.
    const db = visibilityDb({ hidden: ['viewer'] });
    assert.deepEqual(await hiddenFromViewer(db, 'viewer'), []);
    assert.equal(await isHiddenFromViewer(db, 'viewer', 'viewer'), false);
  });

  it('answers the pairwise question for either reason', async () => {
    const blockedDb = visibilityDb({
      blocks: [{ blockerId: 'target', blockedId: 'viewer' }],
    });
    assert.equal(await isHiddenFromViewer(blockedDb, 'viewer', 'target'), true);

    const hiddenDb = visibilityDb({ hidden: ['target'] });
    assert.equal(await isHiddenFromViewer(hiddenDb, 'viewer', 'target'), true);

    const openDb = visibilityDb({});
    assert.equal(await isHiddenFromViewer(openDb, 'viewer', 'target'), false);
  });
});
