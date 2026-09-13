import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FOLLOW_SUGGESTIONS_DEFAULT_LIMIT,
  FOLLOW_SUGGESTIONS_MAX_LIMIT,
  FollowSuggestion,
  FollowSuggestionsResponse,
  RELATIONSHIP_LIST_DEFAULT_LIMIT,
  RELATIONSHIP_LIST_MAX_LIMIT,
  RelationshipListKind,
  RelationshipListQuery,
  RelationshipListResponse,
  RelationshipMember,
} from '@sunsteel/contracts';

import { DatabaseService } from '../database/database.service';
import { normalizeUsername } from './username';

// Identity-only projection shared by every relationship surface. It matches
// `UserSearchResponse`, so a list can never leak email or any private section.
const memberSelect = {
  id: true,
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
} as const;

type MemberRecord = Prisma.UserGetPayload<{ select: typeof memberSelect }>;

interface RelationshipRow {
  createdAt: Date;
  member: MemberRecord;
}

export interface RelationshipCursor {
  createdAt: Date;
  userId: string;
}

// Bounds the two-hop graph read behind suggestions so one well-connected
// account cannot turn a sidebar suggestion into an unbounded scan.
export const FOLLOW_SUGGESTION_CANDIDATE_CAP = 200;

export function encodeRelationshipCursor(cursor: RelationshipCursor): string {
  return Buffer.from(
    `${cursor.createdAt.toISOString()}|${cursor.userId}`,
    'utf8',
  ).toString('base64url');
}

export function decodeRelationshipCursor(value: string): RelationshipCursor {
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  const createdAt = new Date(decoded.slice(0, separator));
  const userId = decoded.slice(separator + 1);
  if (separator <= 0 || !userId || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException('Invalid cursor');
  }
  return { createdAt, userId };
}

export interface RankedSuggestion {
  id: string;
  followsMe: boolean;
  mutualCount: number;
}

/**
 * People who already follow the viewer come first (following back is the most
 * likely wanted action), then accounts followed by more of the people the
 * viewer follows. The id tie-break keeps pages stable between requests.
 */
export function rankFollowSuggestions(
  fanIds: string[],
  networkCounts: Map<string, number>,
  limit: number,
): RankedSuggestion[] {
  const candidates = new Map<string, RankedSuggestion>();
  for (const [id, mutualCount] of networkCounts) {
    candidates.set(id, { id, followsMe: false, mutualCount });
  }
  for (const id of fanIds) {
    candidates.set(id, {
      id,
      followsMe: true,
      mutualCount: networkCounts.get(id) ?? 0,
    });
  }
  return [...candidates.values()]
    .sort(
      (a, b) =>
        Number(b.followsMe) - Number(a.followsMe) ||
        b.mutualCount - a.mutualCount ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

function clampLimit(value: number | undefined, fallback: number, max: number) {
  if (value === undefined) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

@Injectable()
export class UserRelationshipsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Relationship lists are readable by any signed-in member, matching the
   * follower/following counts the profile already shows. They are not part of
   * the unguarded `/profiles` read. Entries carry identity only.
   */
  async list(
    viewerId: string,
    identifier: string,
    kind: RelationshipListKind,
    query: RelationshipListQuery = {},
  ): Promise<RelationshipListResponse> {
    const profile = await this.db.user.findFirst({
      where: {
        OR: [{ id: identifier }, { username: normalizeUsername(identifier) }],
      },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException('User not found');
    }

    const limit = clampLimit(
      query.limit,
      RELATIONSHIP_LIST_DEFAULT_LIMIT,
      RELATIONSHIP_LIST_MAX_LIMIT,
    );
    const cursor = query.cursor
      ? decodeRelationshipCursor(query.cursor)
      : null;
    const rows =
      kind === 'following'
        ? await this.readFollowing(profile.id, cursor, limit + 1)
        : await this.readFollowers(
            profile.id,
            kind === 'mutuals' ? viewerId : null,
            cursor,
            limit + 1,
          );

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      kind,
      items: await this.withViewerState(
        viewerId,
        page.map(row => row.member),
      ),
      ...(rows.length > limit && last
        ? {
            nextCursor: encodeRelationshipCursor({
              createdAt: last.createdAt,
              userId: last.member.id,
            }),
          }
        : {}),
    };
  }

  /**
   * Suggestions are a discovery surface, so accounts reached through the
   * viewer's network must allow name or username discovery. People who already
   * follow the viewer are exempt: they appear in the viewer's follower list
   * regardless, so suggesting a follow-back reveals nothing new.
   */
  async suggestions(
    viewerId: string,
    requestedLimit?: number,
  ): Promise<FollowSuggestionsResponse> {
    const limit = clampLimit(
      requestedLimit,
      FOLLOW_SUGGESTIONS_DEFAULT_LIMIT,
      FOLLOW_SUGGESTIONS_MAX_LIMIT,
    );
    const followed = await this.db.userFollow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    const followedIds = followed.map(row => row.followingId);
    const excludedIds = [...followedIds, viewerId];

    const [networkCounts, fans] = await Promise.all([
      this.readNetworkCounts(followedIds, excludedIds),
      this.db.userFollow.findMany({
        where: { followingId: viewerId, followerId: { notIn: excludedIds } },
        orderBy: [{ createdAt: 'desc' }, { followerId: 'desc' }],
        take: FOLLOW_SUGGESTION_CANDIDATE_CAP,
        select: { followerId: true },
      }),
    ]);

    const ranked = rankFollowSuggestions(
      fans.map(row => row.followerId),
      networkCounts,
      limit,
    );
    if (ranked.length === 0) return { items: [] };

    const members = await this.db.user.findMany({
      where: { id: { in: ranked.map(candidate => candidate.id) } },
      select: memberSelect,
    });
    const membersById = new Map(members.map(member => [member.id, member]));

    return {
      items: ranked.flatMap((candidate): FollowSuggestion[] => {
        const member = membersById.get(candidate.id);
        if (!member) return [];
        return [
          {
            ...member,
            isFollowedByMe: false,
            followsMe: candidate.followsMe,
            reason: candidate.followsMe
              ? 'FOLLOWS_YOU'
              : 'FOLLOWED_BY_PEOPLE_YOU_FOLLOW',
            mutualCount: candidate.mutualCount,
          },
        ];
      }),
    };
  }

  /** Discoverable accounts followed by the viewer's follows, with overlap. */
  private async readNetworkCounts(
    followedIds: string[],
    excludedIds: string[],
  ): Promise<Map<string, number>> {
    if (followedIds.length === 0) return new Map();
    const groups = await this.db.userFollow.groupBy({
      by: ['followingId'],
      where: {
        followerId: { in: followedIds },
        followingId: { notIn: excludedIds },
        following: {
          OR: [{ discoverableByName: true }, { discoverableByUsername: true }],
        },
      },
      _count: { followingId: true },
      orderBy: [{ _count: { followingId: 'desc' } }, { followingId: 'asc' }],
      take: FOLLOW_SUGGESTION_CANDIDATE_CAP,
    });
    return new Map(
      groups.map((group): [string, number] => [
        group.followingId,
        group._count.followingId,
      ]),
    );
  }

  private async readFollowers(
    profileId: string,
    mutualViewerId: string | null,
    cursor: RelationshipCursor | null,
    take: number,
  ): Promise<RelationshipRow[]> {
    const rows = await this.db.userFollow.findMany({
      where: {
        followingId: profileId,
        // Mutuals: followers of the profile whom the viewer also follows.
        ...(mutualViewerId
          ? { follower: { followers: { some: { followerId: mutualViewerId } } } }
          : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  createdAt: cursor.createdAt,
                  followerId: { lt: cursor.userId },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { followerId: 'desc' }],
      take,
      select: { createdAt: true, follower: { select: memberSelect } },
    });
    return rows.map(row => ({ createdAt: row.createdAt, member: row.follower }));
  }

  private async readFollowing(
    profileId: string,
    cursor: RelationshipCursor | null,
    take: number,
  ): Promise<RelationshipRow[]> {
    const rows = await this.db.userFollow.findMany({
      where: {
        followerId: profileId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  createdAt: cursor.createdAt,
                  followingId: { lt: cursor.userId },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { followingId: 'desc' }],
      take,
      select: { createdAt: true, following: { select: memberSelect } },
    });
    return rows.map(row => ({
      createdAt: row.createdAt,
      member: row.following,
    }));
  }

  private async withViewerState(
    viewerId: string,
    members: MemberRecord[],
  ): Promise<RelationshipMember[]> {
    if (members.length === 0) return [];
    const ids = members.map(member => member.id);
    const [followedByViewer, followingViewer] = await Promise.all([
      this.db.userFollow.findMany({
        where: { followerId: viewerId, followingId: { in: ids } },
        select: { followingId: true },
      }),
      this.db.userFollow.findMany({
        where: { followingId: viewerId, followerId: { in: ids } },
        select: { followerId: true },
      }),
    ]);
    const followedIds = new Set(followedByViewer.map(row => row.followingId));
    const followerIds = new Set(followingViewer.map(row => row.followerId));
    return members.map(member => ({
      ...member,
      isFollowedByMe: followedIds.has(member.id),
      followsMe: followerIds.has(member.id),
    }));
  }
}
