import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { escapeLike } from '../common/like-pattern';
import {
  SEARCH_PAGE_SIZE,
  SEARCH_PAGE_SIZE_MAX,
} from '@sunsteel/contracts';

/**
 * NAV-01's pure rules, kept out of the service so they are tested without a
 * database: the page size, the opaque cursors and the one place a member's
 * text becomes a `LIKE` pattern.
 */

export function searchPageSize(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), SEARCH_PAGE_SIZE_MAX);
}

/**
 * A `LIKE`/`ILIKE` pattern that matches the query anywhere, with the query's
 * own `%`, `_` and backslash taken literally (the statement says
 * `ESCAPE '\'`). Without it "100%" would match every note.
 */
export function containsPattern(query: string): string {
  return `%${escapeLike(query)}%`;
}

/** Members are ordered by their unique handle, so the handle is the cursor. */
export function encodeMemberCursor(username: string): string {
  return Buffer.from(`m:${username}`, 'utf8').toString('base64url');
}

export function decodeMemberCursor(cursor?: string): string | null {
  if (!cursor) return null;
  const match = /^m:(.+)$/s.exec(decode(cursor));
  if (!match) throw invalidCursor();
  return match[1];
}

/**
 * Routines and workouts are ordered newest first by a time, then by id, so a
 * cursor is the last row's pair. The prefix keeps one category's cursor from
 * being read as another's.
 */
export function encodeTimeCursor(
  kind: 'r' | 'w',
  at: Date,
  id: string,
): string {
  return Buffer.from(`${kind}:${at.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeTimeCursor(
  kind: 'r' | 'w',
  cursor?: string,
): { at: Date; id: string } | null {
  if (!cursor) return null;
  const match = new RegExp(`^${kind}:([^|]+)\\|(.+)$`).exec(decode(cursor));
  if (!match) throw invalidCursor();
  const at = new Date(match[1]);
  if (Number.isNaN(at.getTime())) throw invalidCursor();
  return { at, id: match[2] };
}

/**
 * The rows after a newest-first cursor, for a Prisma `where` ordered by
 * `updatedAt desc, id desc`.
 */
export function afterUpdatedAt(
  cursor: { at: Date; id: string } | null,
): Prisma.RoutineWhereInput {
  if (!cursor) return {};
  return {
    OR: [
      { updatedAt: { lt: cursor.at } },
      { updatedAt: cursor.at, id: { lt: cursor.id } },
    ],
  };
}

/**
 * ROUT-07's candidate set for one non-owner, as a database filter, so a page
 * of matches is a page of readable routines rather than a scan filtered
 * afterwards. It is `canViewRoutine` for somebody who is not the owner: a
 * hidden or private routine never; otherwise both the account's routines rule
 * and the routine's own visibility must allow the viewer -- `PUBLIC` for
 * anyone, `FOLLOWERS` only for someone who follows the owner. The service
 * still asks `canViewRoutine` of every row it returns.
 */
export function readableSharedRoutineWhere(
  followedIds: string[],
): Prisma.RoutineWhereInput {
  return {
    moderationHiddenAt: null,
    OR: [
      { visibility: 'PUBLIC', user: { routinesVisibility: 'PUBLIC' } },
      ...(followedIds.length
        ? [
            {
              userId: { in: followedIds },
              visibility: { in: ['PUBLIC', 'FOLLOWERS'] },
              user: { routinesVisibility: { in: ['PUBLIC', 'FOLLOWERS'] } },
            } satisfies Prisma.RoutineWhereInput,
          ]
        : []),
    ],
  };
}

function decode(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}

function invalidCursor() {
  return new BadRequestException('Invalid cursor');
}
