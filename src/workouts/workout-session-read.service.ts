import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkoutSessionStatus,
} from '@prisma/client';
import {
  ListSessionsParams,
  WorkoutSessionListResponse,
  WorkoutSessionSummary,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
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
    return useStarted
      ? { startedAt: dateFilter }
      : { endedAt: dateFilter };
  }

  private buildWhere(
    userId: string,
    params: ListSessionsParams,
  ): Prisma.WorkoutSessionWhereInput {
    return {
      userId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.routineId ? { routineId: params.routineId } : {}),
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

    const items: WorkoutSessionSummary[] = page.map((session) => ({
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
        id: session.routine.id,
        name: session.routine.name,
        dayName: dayNameFrom(session.routineDay.dayOfWeek),
      },
    }));

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
