import { Injectable, NotFoundException } from '@nestjs/common';
import {
  RECENT_SEARCHES_MAX,
  type RecentSearchesResponse,
  type RecentSearchItem,
  type RecentSearchKind,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { usableExerciseWhere } from '../exercises/exercise-access';
import {
  ROUTINE_SUMMARY_SELECT,
  toSharedRoutineSummary,
} from '../routines/routine-summary';
import { canViewRoutine } from '../routines/routine-visibility';
import { hiddenFromViewer } from '../users/member-blocks';
import { WORKOUT_SESSION_LIST_SELECT } from '../workouts/workout-session.selects';
import { toWorkoutSessionSummary } from '../workouts/workout-session-read.service';
import {
  type RecentSearchRow,
  recentSearchKey,
  rowsToDrop,
  splitResolved,
} from './recent-search-rules';

/** One recent item without its instant, kind by kind. */
type Resolved = RecentSearchItem extends infer Item
  ? Item extends RecentSearchItem
    ? Omit<Item, 'openedAt'>
    : never
  : never;

/**
 * NAV-03. The results a member last opened from search, on the account.
 *
 * A row is a reference, resolved again on every read under the rule that
 * governs its target -- the rule a direct visit would meet, not the search
 * rule, because the member already knew where they went: a member who is not
 * the viewer and not hidden from them (`hiddenFromViewer`: blocks either way,
 * moderation), an exercise the viewer may use, their own routine or one
 * `canViewRoutine` lets them read, and their own workout. A row that no longer
 * resolves is deleted, so the list never keeps a trace of a member who has
 * blocked the viewer. Recording asks the same question first and answers 404
 * for a target the viewer could not open.
 */
@Injectable()
export class RecentSearchesService {
  constructor(private readonly db: DatabaseService) {}

  async list(viewerId: string): Promise<RecentSearchesResponse> {
    const rows = await this.db.recentSearch.findMany({
      where: { userId: viewerId },
      orderBy: [{ openedAt: 'desc' }, { targetId: 'asc' }],
      take: RECENT_SEARCHES_MAX,
    });
    const resolved = await this.resolve(viewerId, rows);
    const { kept, dropped } = splitResolved(rows, resolved);
    if (dropped.length) {
      await this.db.recentSearch.deleteMany({
        where: {
          userId: viewerId,
          OR: dropped.map((row) => ({ kind: row.kind, targetId: row.targetId })),
        },
      });
    }
    return {
      items: kept.map(
        ({ row, item }) =>
          ({ ...item, openedAt: row.openedAt.toISOString() }) as RecentSearchItem,
      ),
    };
  }

  async record(
    viewerId: string,
    kind: RecentSearchKind,
    targetId: string,
  ): Promise<RecentSearchesResponse> {
    const probe: RecentSearchRow = { kind, targetId, openedAt: new Date() };
    const resolved = await this.resolve(viewerId, [probe]);
    if (!resolved.has(recentSearchKey(probe))) {
      throw new NotFoundException('Not found');
    }
    await this.db.$transaction(async (tx) => {
      await tx.recentSearch.upsert({
        where: { userId_kind_targetId: { userId: viewerId, kind, targetId } },
        create: { userId: viewerId, kind, targetId },
        update: { openedAt: new Date() },
      });
      const rows = await tx.recentSearch.findMany({
        where: { userId: viewerId },
        select: { kind: true, targetId: true, openedAt: true },
      });
      const drop = rowsToDrop(rows);
      if (drop.length) {
        await tx.recentSearch.deleteMany({
          where: {
            userId: viewerId,
            OR: drop.map((row) => ({ kind: row.kind, targetId: row.targetId })),
          },
        });
      }
    });
    return this.list(viewerId);
  }

  async remove(
    viewerId: string,
    kind: RecentSearchKind,
    targetId: string,
  ): Promise<RecentSearchesResponse> {
    await this.db.recentSearch.deleteMany({
      where: { userId: viewerId, kind, targetId },
    });
    return this.list(viewerId);
  }

  async clear(viewerId: string): Promise<RecentSearchesResponse> {
    await this.db.recentSearch.deleteMany({ where: { userId: viewerId } });
    return { items: [] };
  }

  /** Each row's target as this viewer may see it, keyed by `kind:targetId`. */
  private async resolve(
    viewerId: string,
    rows: readonly RecentSearchRow[],
  ): Promise<Map<string, Resolved>> {
    const ids = (kind: RecentSearchKind) =>
      rows.filter((row) => row.kind === kind).map((row) => row.targetId);
    const memberIds = ids('MEMBER');
    const exerciseIds = ids('EXERCISE');
    const routineIds = ids('ROUTINE');
    const workoutIds = ids('WORKOUT');
    const needsVisibility = memberIds.length > 0 || routineIds.length > 0;
    const [hidden, followRows] = needsVisibility
      ? await Promise.all([
          hiddenFromViewer(this.db, viewerId),
          this.db.userFollow.findMany({
            where: { followerId: viewerId },
            select: { followingId: true },
          }),
        ])
      : [[], []];
    const hiddenSet = new Set(hidden);
    const followed = new Set(followRows.map((row) => row.followingId));

    const [members, exercises, routines, sessions] = await Promise.all([
      memberIds.length
        ? this.db.user.findMany({
            where: {
              id: { in: memberIds, not: viewerId, notIn: [...hiddenSet] },
            },
            select: {
              id: true,
              username: true,
              name: true,
              lastName: true,
              avatarUrl: true,
            },
          })
        : [],
      exerciseIds.length
        ? this.db.exercise.findMany({
            where: { id: { in: exerciseIds }, ...usableExerciseWhere(viewerId) },
            select: { id: true, name: true, ownerId: true, archivedAt: true },
          })
        : [],
      routineIds.length
        ? this.db.routine.findMany({
            where: { id: { in: routineIds } },
            select: {
              ...ROUTINE_SUMMARY_SELECT,
              isCompleted: true,
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
            },
          })
        : [],
      workoutIds.length
        ? this.db.workoutSession.findMany({
            where: { id: { in: workoutIds }, userId: viewerId },
            select: WORKOUT_SESSION_LIST_SELECT,
          })
        : [],
    ]);

    const out = new Map<string, Resolved>();
    for (const member of members) {
      out.set(recentSearchKey({ kind: 'MEMBER', targetId: member.id }), {
        kind: 'MEMBER',
        member,
      });
    }
    for (const exercise of exercises) {
      out.set(recentSearchKey({ kind: 'EXERCISE', targetId: exercise.id }), {
        kind: 'EXERCISE',
        exercise: {
          id: exercise.id,
          name: exercise.name,
          isCustom: exercise.ownerId !== null,
          archivedAt: exercise.archivedAt?.toISOString() ?? null,
        },
      });
    }
    for (const routine of routines) {
      const isOwner = routine.user.id === viewerId;
      const readable =
        isOwner ||
        (!hiddenSet.has(routine.user.id) &&
          canViewRoutine(
            routine.user.routinesVisibility,
            routine.visibility,
            { isOwner: false, isFollower: followed.has(routine.user.id) },
            routine,
          ));
      if (!readable) continue;
      out.set(recentSearchKey({ kind: 'ROUTINE', targetId: routine.id }), {
        kind: 'ROUTINE',
        routine: {
          ...toSharedRoutineSummary(routine),
          author: isOwner
            ? null
            : {
                username: routine.user.username,
                name: routine.user.name,
                lastName: routine.user.lastName,
                avatarUrl: routine.user.avatarUrl,
              },
          isArchived: routine.isCompleted,
        },
      });
    }
    for (const session of sessions) {
      out.set(recentSearchKey({ kind: 'WORKOUT', targetId: session.id }), {
        kind: 'WORKOUT',
        session: toWorkoutSessionSummary(session),
      });
    }
    return out;
  }
}
