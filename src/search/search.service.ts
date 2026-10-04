import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizeSearchQuery,
  SEARCH_PREVIEW_LIMIT,
  type MemberSearchPage,
  type RoutineSearchPage,
  type SearchPreviewResponse,
  type SharedRoutineSearchResult,
  type WorkoutSearchPage,
} from '@sunsteel/contracts';
import { escapeLike } from '../common/like-pattern';
import { DatabaseService } from '../database/database.service';
import {
  ROUTINE_SUMMARY_SELECT,
  toSharedRoutineSummary,
} from '../routines/routine-summary';
import { canViewRoutine } from '../routines/routine-visibility';
import { hiddenFromViewer } from '../users/member-blocks';
import { memberSearchBranches } from '../users/member-search';
import { WORKOUT_SESSION_LIST_SELECT } from '../workouts/workout-session.selects';
import { toWorkoutSessionSummary } from '../workouts/workout-session-read.service';
import {
  afterUpdatedAt,
  containsPattern,
  decodeMemberCursor,
  decodeTimeCursor,
  encodeMemberCursor,
  encodeTimeCursor,
  readableSharedRoutineWhere,
  searchPageSize,
} from './search-rules';

const EMPTY = { items: [], nextCursor: null };

const SHARED_ROUTINE_SELECT = {
  ...ROUTINE_SUMMARY_SELECT,
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
} as const;

/**
 * NAV-01. One search over the three categories the server owns: members,
 * routines other members shared, and the searcher's own workouts. Exercises
 * and the searcher's own routines are matched in the client (see contracts'
 * `search.ts` for why).
 *
 * Nothing here is a new rule. Members follow `PROF-09`'s discovery switches
 * through `memberSearchBranches`, routines `ROUT-07`'s `canViewRoutine`
 * candidate set, and both drop `hiddenFromViewer` -- blocks either way and
 * members a moderator hid. Every read is one bounded, keyset-paged query.
 */
@Injectable()
export class SearchService {
  constructor(private readonly db: DatabaseService) {}

  async preview(
    viewerId: string,
    rawQuery: string,
  ): Promise<SearchPreviewResponse> {
    const query = normalizeSearchQuery(rawQuery);
    if (!query) {
      return { query: null, members: EMPTY, routines: EMPTY, workouts: EMPTY };
    }
    const hidden = await hiddenFromViewer(this.db, viewerId);
    const [members, routines, workouts] = await Promise.all([
      this.memberPage(viewerId, hidden, query, null, SEARCH_PREVIEW_LIMIT),
      this.routinePage(viewerId, hidden, query, null, SEARCH_PREVIEW_LIMIT),
      this.workoutPage(viewerId, query, null, SEARCH_PREVIEW_LIMIT),
    ]);
    return { query, members, routines, workouts };
  }

  async members(
    viewerId: string,
    rawQuery: string,
    cursor?: string,
    limit?: number,
  ): Promise<MemberSearchPage> {
    const after = decodeMemberCursor(cursor);
    const query = normalizeSearchQuery(rawQuery);
    if (!query) return EMPTY;
    const hidden = await hiddenFromViewer(this.db, viewerId);
    return this.memberPage(viewerId, hidden, query, after, searchPageSize(limit));
  }

  async routines(
    viewerId: string,
    rawQuery: string,
    cursor?: string,
    limit?: number,
  ): Promise<RoutineSearchPage> {
    const after = decodeTimeCursor('r', cursor);
    const query = normalizeSearchQuery(rawQuery);
    if (!query) return EMPTY;
    const hidden = await hiddenFromViewer(this.db, viewerId);
    return this.routinePage(
      viewerId,
      hidden,
      query,
      after,
      searchPageSize(limit),
    );
  }

  async workouts(
    viewerId: string,
    rawQuery: string,
    cursor?: string,
    limit?: number,
  ): Promise<WorkoutSearchPage> {
    const after = decodeTimeCursor('w', cursor);
    const query = normalizeSearchQuery(rawQuery);
    if (!query) return EMPTY;
    return this.workoutPage(viewerId, query, after, searchPageSize(limit));
  }

  private async memberPage(
    viewerId: string,
    hidden: string[],
    query: string,
    after: string | null,
    limit: number,
  ): Promise<MemberSearchPage> {
    const branches = memberSearchBranches(query);
    if (!branches) return EMPTY;
    const rows = await this.db.user.findMany({
      where: {
        id: { not: viewerId, notIn: hidden },
        OR: branches,
        ...(after ? { username: { gt: after } } : {}),
      },
      select: {
        id: true,
        username: true,
        name: true,
        lastName: true,
        avatarUrl: true,
      },
      orderBy: { username: 'asc' },
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor:
        rows.length > limit
          ? encodeMemberCursor(items[items.length - 1].username)
          : null,
    };
  }

  private async routinePage(
    viewerId: string,
    hidden: string[],
    query: string,
    after: { at: Date; id: string } | null,
    limit: number,
  ): Promise<RoutineSearchPage> {
    const followRows = await this.db.userFollow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    const followed = new Set(followRows.map((row) => row.followingId));
    const rows = await this.db.routine.findMany({
      where: {
        AND: [
          // The searcher's own routines are matched in the client; an
          // archived routine is not on offer, as in discovery.
          { userId: { not: viewerId, notIn: hidden }, isCompleted: false },
          readableSharedRoutineWhere([...followed]),
          {
            OR: [
              { name: { contains: escapeLike(query), mode: 'insensitive' } },
              {
                description: {
                  contains: escapeLike(query),
                  mode: 'insensitive',
                },
              },
            ],
          },
          // A routine with nothing programmed is not a programme anyone can
          // follow (ROUT-07), judged on the baseline, never a block's copy.
          {
            days: {
              some: {
                trainingBlockId: null,
                temporaryOverrideId: null,
                exercises: { some: {} },
              },
            },
          },
          afterUpdatedAt(after),
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SHARED_ROUTINE_SELECT,
    });
    const page = rows.slice(0, limit);
    const items: SharedRoutineSearchResult[] = page
      .filter((routine) =>
        canViewRoutine(
          routine.user.routinesVisibility,
          routine.visibility,
          { isOwner: false, isFollower: followed.has(routine.user.id) },
          routine,
        ),
      )
      .map((routine) => ({
        ...toSharedRoutineSummary(routine),
        author: {
          username: routine.user.username,
          name: routine.user.name,
          lastName: routine.user.lastName,
          avatarUrl: routine.user.avatarUrl,
        },
      }));
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeTimeCursor('r', last.updatedAt, last.id)
          : null,
    };
  }

  /**
   * The searcher's own workouts whose routine or day name, as recorded when
   * the workout was trained, or whose workout note contains the query. The
   * names are read from the session's snapshot where it has one -- the names
   * the history list shows -- and from the routine and day as they are now
   * only for a session without one.
   */
  private async workoutPage(
    viewerId: string,
    query: string,
    after: { at: Date; id: string } | null,
    limit: number,
  ): Promise<WorkoutSearchPage> {
    const pattern = containsPattern(query);
    const rows = await this.db.$queryRaw<{ id: string; startedAt: Date }[]>`
      SELECT ws."id", ws."startedAt"
      FROM "WorkoutSession" ws
      LEFT JOIN "WorkoutSessionSnapshot" s ON s."sessionId" = ws."id"
      LEFT JOIN "Routine" r ON r."id" = ws."routineId"
      LEFT JOIN "RoutineDay" d ON d."id" = ws."routineDayId"
      WHERE ws."userId" = ${viewerId}
        AND (
          (CASE WHEN s."sessionId" IS NOT NULL
                THEN s."payload"->'routine'->>'name' ELSE r."name" END)
            ILIKE ${pattern} ESCAPE '\\'
          OR (CASE WHEN s."sessionId" IS NOT NULL
                THEN s."payload"->'routineDay'->>'name' ELSE d."name" END)
            ILIKE ${pattern} ESCAPE '\\'
          OR ws."notes" ILIKE ${pattern} ESCAPE '\\'
        )
        ${
          after
            ? // `startedAt` is a `timestamp` holding UTC wall-clock time. A
              // Date parameter would arrive as `timestamptz` and be shifted by
              // the session's zone before comparing, so the cursor never
              // advanced; the UTC wall clock cast to `timestamp` does not move.
              Prisma.sql`AND (ws."startedAt", ws."id") < (CAST(${after.at
                .toISOString()
                .replace('Z', '')} AS timestamp(3)), ${after.id})`
            : Prisma.empty
        }
      ORDER BY ws."startedAt" DESC, ws."id" DESC
      LIMIT ${limit + 1}
    `;
    const page = rows.slice(0, limit);
    if (page.length === 0) return EMPTY;
    const sessions = await this.db.workoutSession.findMany({
      where: { userId: viewerId, id: { in: page.map((row) => row.id) } },
      select: WORKOUT_SESSION_LIST_SELECT,
    });
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const items = page.flatMap((row) => {
      const session = byId.get(row.id);
      return session ? [toWorkoutSessionSummary(session)] : [];
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        rows.length > limit ? encodeTimeCursor('w', last.startedAt, last.id) : null,
    };
  }
}
