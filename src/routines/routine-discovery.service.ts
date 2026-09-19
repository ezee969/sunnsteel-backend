import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ROUTINE_DISCOVERY_DEFAULT_LIMIT,
  ROUTINE_DISCOVERY_MAX_LIMIT,
  ROUTINE_DISCOVERY_SCAN_LIMIT,
  type DiscoverableRoutine,
  type RoutineDiscoveryQuery,
  type RoutineDiscoveryResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { blockedIdsWhere, otherPartyId } from '../users/member-blocks';
import { deriveRoutineFacets, matchesDiscoveryFilters } from './routine-facets';
import { canViewRoutine } from './routine-visibility';

const DISCOVERY_SELECT = {
  id: true,
  name: true,
  description: true,
  scheduleMode: true,
  visibility: true,
  goal: true,
  experienceLevel: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      username: true,
      name: true,
      lastName: true,
      avatarUrl: true,
      routinesVisibility: true,
    },
  },
  days: {
    select: {
      exercises: {
        select: {
          restSeconds: true,
          sets: {
            select: {
              repType: true,
              reps: true,
              minReps: true,
              maxReps: true,
            },
          },
          exercise: {
            select: {
              primaryMuscles: true,
              secondaryMuscles: true,
              equipmentRequired: true,
            },
          },
        },
      },
    },
  },
} as const;

/**
 * ROUT-07. Browsing programmes other members have shared.
 *
 * **It is not a new visibility tier.** The candidate set is decided by the
 * shipped `canViewRoutine`, so discovery surfaces exactly what the viewer
 * could already have read by other means: public routines in public accounts,
 * and followers-only ones from accounts they follow. `PROF-10` removes both
 * parties of a block from each other's results, as everywhere else.
 *
 * **The scan is bounded and says so.** Facets are derived per candidate
 * rather than stored, so the read takes at most `ROUTINE_DISCOVERY_SCAN_LIMIT`
 * routines and reports `scanTruncated` when it hit that ceiling, the way
 * `ACH-05` reports a truncated event scan, instead of presenting a partial
 * answer as a complete one.
 */
@Injectable()
export class RoutineDiscoveryService {
  constructor(private readonly db: DatabaseService) {}

  async discover(
    viewerId: string,
    query: RoutineDiscoveryQuery,
  ): Promise<RoutineDiscoveryResponse> {
    const limit = Math.min(
      Math.max(query.limit ?? ROUTINE_DISCOVERY_DEFAULT_LIMIT, 1),
      ROUTINE_DISCOVERY_MAX_LIMIT,
    );
    const offset = decodeCursor(query.cursor);

    const [blockRows, followRows] = await Promise.all([
      this.db.userBlock.findMany({
        where: blockedIdsWhere(viewerId),
        select: { blockerId: true, blockedId: true },
      }),
      this.db.userFollow.findMany({
        where: { followerId: viewerId },
        select: { followingId: true },
      }),
    ]);
    const hidden = blockRows.map((row) => otherPartyId(row, viewerId));
    const followed = new Set(followRows.map((row) => row.followingId));

    const rows = await this.db.routine.findMany({
      where: {
        // The owner's own routines are not discoveries, and an archived one
        // is not on offer.
        userId: { not: viewerId, notIn: hidden },
        isCompleted: false,
        visibility: { in: ['PUBLIC', 'FOLLOWERS'] },
        user: { routinesVisibility: { in: ['PUBLIC', 'FOLLOWERS'] } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: ROUTINE_DISCOVERY_SCAN_LIMIT + 1,
      select: DISCOVERY_SELECT,
    });
    const scanTruncated = rows.length > ROUTINE_DISCOVERY_SCAN_LIMIT;
    const scanned = rows.slice(0, ROUTINE_DISCOVERY_SCAN_LIMIT);

    const matched: DiscoverableRoutine[] = [];
    for (const routine of scanned) {
      const allowed = canViewRoutine(
        routine.user.routinesVisibility,
        routine.visibility,
        { isOwner: false, isFollower: followed.has(routine.user.id) },
      );
      if (!allowed) continue;

      const facets = deriveRoutineFacets(routine.days);
      // A routine with nothing programmed is not a programme anyone can
      // follow, so it is never offered as one.
      if (facets.exerciseCount === 0) continue;

      const candidate = {
        ...facets,
        name: routine.name,
        description: routine.description ?? null,
        goal: routine.goal,
        experienceLevel: routine.experienceLevel,
      };
      if (!matchesDiscoveryFilters(candidate, query)) continue;

      matched.push({
        routineId: routine.id,
        name: routine.name,
        description: routine.description ?? null,
        scheduleMode: routine.scheduleMode,
        goal: routine.goal,
        experienceLevel: routine.experienceLevel,
        ...facets,
        author: {
          username: routine.user.username ?? '',
          name: routine.user.name,
          lastName: routine.user.lastName,
          avatarUrl: routine.user.avatarUrl,
        },
        updatedAt: routine.updatedAt.toISOString(),
      });
    }

    const page = matched.slice(offset, offset + limit);
    const hasMore = matched.length > offset + limit;
    return {
      routines: page,
      ...(hasMore ? { nextCursor: encodeCursor(offset + limit) } : {}),
      scanTruncated,
    };
  }
}

/**
 * The cursor is an offset into the filtered result, not a database key,
 * because the filtering happens after the scan. It is opaque so that it can
 * become a keyset cursor later without changing the contract.
 */
function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = /^o:(\d+)$/.exec(decoded);
  if (!match) throw new BadRequestException('Invalid cursor');
  return Number(match[1]);
}
