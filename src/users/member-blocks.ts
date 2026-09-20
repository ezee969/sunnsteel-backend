import type { Prisma } from '@prisma/client';

/**
 * PROF-10. A block is stored once, from the blocker to the blocked, and read
 * as **mutual** everywhere: neither account appears in the other's search,
 * suggestions, relationship lists or profile reads. Enforcing it in one
 * direction only would hide the blocked account from the blocker while leaving
 * the blocker visible to them, which is the half nobody asks for.
 *
 * These are the two shapes every caller needs, kept together so a new read
 * cannot invent a third interpretation of the same relation.
 */

/** Rows matching a block between the two accounts, in either direction. */
export function blockPairWhere(
  a: string,
  b: string,
): Prisma.UserBlockWhereInput {
  return {
    OR: [
      { blockerId: a, blockedId: b },
      { blockerId: b, blockedId: a },
    ],
  };
}

/** Every account this viewer blocks or is blocked by. */
export function blockedIdsWhere(viewerId: string): Prisma.UserBlockWhereInput {
  return { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] };
}

/** The other account of a block row, seen from this viewer. */
export function otherPartyId(
  row: { blockerId: string; blockedId: string },
  viewerId: string,
): string {
  return row.blockerId === viewerId ? row.blockedId : row.blockerId;
}

// TRUST-04 -------------------------------------------------------------------
//
// A moderation hide takes an account out of every member-facing read, which
// is the same job a block already does — the difference is that a block is one
// viewer's choice and a hide applies to everyone but the account itself.
// Rather than adding a second exclusion beside the first at each read, the two
// are answered together here, so a read written later cannot honour one and
// silently omit the other. The helpers take the caller's own `db` for the
// reason the builders above do: a privacy control must not be able to fail
// open because of how a module was wired.

/** The minimum Prisma surface these need; `DatabaseService` satisfies it. */
export interface MemberVisibilityDb {
  userBlock: {
    findMany(args: {
      where: Prisma.UserBlockWhereInput;
      select: { blockerId: true; blockedId: true };
    }): Promise<{ blockerId: string; blockedId: string }[]>;
    count(args: { where: Prisma.UserBlockWhereInput }): Promise<number>;
  };
  user: {
    findMany(args: {
      where: Prisma.UserWhereInput;
      select: { id: true };
    }): Promise<{ id: string }[]>;
    count(args: { where: Prisma.UserWhereInput }): Promise<number>;
  };
}

/**
 * Every account this viewer must neither see nor be seen by: blocks in either
 * direction (`PROF-10`) plus every account a `TRUST-04` hide has removed from
 * member-facing reads. The viewer is never in the list — a hidden account
 * still reads its own profile, lists and activity, because the hide takes it
 * away from everyone else rather than from itself.
 */
export async function hiddenFromViewer(
  db: MemberVisibilityDb,
  viewerId: string,
): Promise<string[]> {
  const [blocks, moderated] = await Promise.all([
    db.userBlock.findMany({
      where: blockedIdsWhere(viewerId),
      select: { blockerId: true, blockedId: true },
    }),
    db.user.findMany({
      where: { moderationHiddenAt: { not: null }, id: { not: viewerId } },
      select: { id: true },
    }),
  ]);
  const ids = new Set(blocks.map((row) => otherPartyId(row, viewerId)));
  for (const row of moderated) ids.add(row.id);
  return [...ids];
}

/**
 * Whether one account is unreachable for this viewer, for the reads that ask
 * about a single member. The answer is the 404 `PROF-10` already gives, for
 * either reason: saying which one applied would disclose the other.
 */
export async function isHiddenFromViewer(
  db: MemberVisibilityDb,
  viewerId: string,
  targetId: string,
): Promise<boolean> {
  if (viewerId === targetId) return false;
  const [blocked, moderated] = await Promise.all([
    db.userBlock.count({ where: blockPairWhere(viewerId, targetId) }),
    db.user.count({
      where: { id: targetId, moderationHiddenAt: { not: null } },
    }),
  ]);
  return blocked > 0 || moderated > 0;
}
