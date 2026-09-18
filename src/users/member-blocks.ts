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
