import { readSnapshot } from './analytics/session-snapshot';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkoutSessionStatus } from '@prisma/client';
import {
  ListSessionsParams,
  WorkoutSessionListResponse,
  WorkoutSessionSummary,
  WorkoutStatsResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { WorkoutStatsQueryDto } from './dto/workout-stats.dto';
import {
  buildWorkoutSessionSelect,
  dayNameFrom,
  WORKOUT_SESSION_LIST_SELECT,
} from './workout-session.selects';

type WorkoutSessionListRow = Prisma.WorkoutSessionGetPayload<{
  select: typeof WORKOUT_SESSION_LIST_SELECT;
}>;

@Injectable()
export class WorkoutSessionReadService {
  constructor(private readonly db: DatabaseService) {}

  async getStats(
    userId: string,
    query: WorkoutStatsQueryDto,
  ): Promise<WorkoutStatsResponse> {
    const start = new Date(query.weekStart);
    const end = new Date(query.weekEnd);
    const duration = end.getTime() - start.getTime();
    // Bound the timestamp-only weekly read, including daylight-saving weeks.
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 8 * 86400000
    ) {
      throw new BadRequestException('Invalid week interval');
    }
    const [total, totalCompleted, completedThisWeek] =
      await this.db.$transaction(
        [
          this.db.workoutSession.count({
            where: { userId },
          }),
          this.db.workoutSession.count({
            where: { userId, status: WorkoutSessionStatus.COMPLETED },
          }),
          this.db.workoutSession.findMany({
            where: {
              userId,
              status: WorkoutSessionStatus.COMPLETED,
              endedAt: { gte: start, lt: end },
            },
            select: { endedAt: true },
          }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: query.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return {
      totalCompleted,
      completionRate: total ? Math.round((totalCompleted / total) * 100) : 0,
      weeklyWorkoutsCount: completedThisWeek.length,
      activeDaysThisWeek: new Set(
        completedThisWeek
          .filter((row) => row.endedAt)
          .map((row) => dateFormatter.format(row.endedAt!)),
      ).size,
    };
  }

  private clampTake(limit?: number): number {
    return Math.min(Math.max(limit ?? 20, 1), 50) + 1;
  }

  private buildDateFilter(params: ListSessionsParams): {
    startedAt?: Prisma.DateTimeFilter;
    endedAt?: Prisma.DateTimeFilter;
  } {
    const gte = params.from ? new Date(params.from) : undefined;
    const lte = params.to ? new Date(params.to) : undefined;

    if (!gte && !lte) {
      return {};
    }

    const dateFilter: Prisma.DateTimeFilter = {
      ...(gte ? { gte } : {}),
      ...(lte ? { lte } : {}),
    };

    const useStarted = params.status === WorkoutSessionStatus.IN_PROGRESS;
    return useStarted ? { startedAt: dateFilter } : { endedAt: dateFilter };
  }

  private buildWhere(
    userId: string,
    params: ListSessionsParams,
  ): Prisma.WorkoutSessionWhereInput {
    return {
      userId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.routineId
        ? {
            OR: [
              { sourceRoutineId: params.routineId },
              { sourceRoutineId: null, routineId: params.routineId },
            ],
          }
        : {}),
      ...this.buildDateFilter(params),
      ...(params.q
        ? {
            notes: {
              contains: params.q,
              mode: 'insensitive',
            } satisfies Prisma.StringNullableFilter,
          }
        : {}),
    };
  }

  private buildOrderBy(
    sort: ListSessionsParams['sort'],
  ): Prisma.WorkoutSessionOrderByWithRelationInput[] {
    switch (sort) {
      case 'finishedAt:asc':
        return [{ endedAt: 'asc' }, { id: 'asc' }];
      case 'startedAt:asc':
        return [{ startedAt: 'asc' }, { id: 'asc' }];
      case 'startedAt:desc':
        return [{ startedAt: 'desc' }, { id: 'desc' }];
      case 'finishedAt:desc':
      default:
        return [{ endedAt: 'desc' }, { id: 'desc' }];
    }
  }

  private mapListResponse(
    list: WorkoutSessionListRow[],
    take: number,
  ): WorkoutSessionListResponse {
    const hasNext = list.length === take;
    const page = hasNext ? list.slice(0, -1) : list;

    const items: WorkoutSessionSummary[] = page.map((session) => {
      const snapshot = session.snapshot
        ? readSnapshot(session.snapshot.payload)
        : null;
      return {
        id: session.id,
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        durationSec: session.durationSec ?? undefined,
        notes: session.notes ?? undefined,
        totalVolume: undefined,
        totalSets: undefined,
        totalExercises: undefined,
        routine: {
          id: snapshot?.sourceRoutineId ?? session.routine!.id,
          name: snapshot?.routine.name ?? session.routine!.name,
          dayName: dayNameFrom(
            snapshot?.routineDay.dayOfWeek ?? session.routineDay!.dayOfWeek,
          ),
        },
      };
    });

    return {
      items,
      nextCursor: hasNext ? items[items.length - 1]?.id : undefined,
    };
  }

  async getActiveSession(userId: string) {
    return this.db.workoutSession.findFirst({
      where: { userId, status: WorkoutSessionStatus.IN_PROGRESS },
      orderBy: { startedAt: 'desc' },
      select: buildWorkoutSessionSelect(),
    });
  }

  async getSessionById(userId: string, id: string) {
    const session = await this.db.workoutSession.findFirst({
      where: { id, userId },
      select: buildWorkoutSessionSelect(true),
    });

    if (!session) {
      throw new NotFoundException('Workout session not found');
    }

    return session;
  }

  async listSessions(userId: string, params: ListSessionsParams) {
    const take = this.clampTake(params.limit);
    const list = await this.db.workoutSession.findMany({
      where: this.buildWhere(userId, params),
      orderBy: this.buildOrderBy(params.sort),
      take,
      skip: params.cursor ? 1 : 0,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      select: WORKOUT_SESSION_LIST_SELECT,
    });

    return this.mapListResponse(list, take);
  }
}
