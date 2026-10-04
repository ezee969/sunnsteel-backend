import type { Prisma } from '@prisma/client';
import { escapeLike } from '../common/like-pattern';
import { normalizeUsername } from './username';

/**
 * PROF-09: what a member search may match, as the branches of one `OR`.
 *
 * Each branch carries the discovery switch that governs it, so a member who
 * turned off name discovery is never found by name and one who turned off
 * username discovery never by handle. A query starting with `@` asks for a
 * handle only. `null` means there is nothing to search for -- not "match
 * everyone", which an empty `OR` would be read as by a careless caller.
 *
 * The query is matched literally (`escapeLike`). The rule lives here once
 * because two reads ask it: `GET /users/search` and `NAV-01`'s unified search. Who is removed from either (the searcher, blocks
 * and moderation hides) is the caller's `hiddenFromViewer`.
 */
export function memberSearchBranches(
  query: string,
): Prisma.UserWhereInput[] | null {
  const trimmed = query.trim();
  if (trimmed === '') return null;
  const handle = normalizeUsername(trimmed);
  if (trimmed.startsWith('@')) {
    return handle
      ? [
          {
            discoverableByUsername: true,
            username: { contains: escapeLike(handle), mode: 'insensitive' },
          },
        ]
      : null;
  }
  return [
    {
      discoverableByName: true,
      OR: [
        { name: { contains: escapeLike(trimmed), mode: 'insensitive' } },
        { lastName: { contains: escapeLike(trimmed), mode: 'insensitive' } },
      ],
    },
    ...(handle
      ? [
          {
            discoverableByUsername: true,
            username: {
              contains: escapeLike(handle),
              mode: 'insensitive' as const,
            },
          },
        ]
      : []),
  ];
}
