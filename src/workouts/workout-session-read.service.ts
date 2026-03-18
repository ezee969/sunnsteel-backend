import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkoutSessionStatus,
} from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import {
  buildWorkoutSessionSelect,
  dayNameFrom,
  WORKOUT_SESSION_LIST_SELECT,
} from './workout-session.selects';

@Injectable()
export class WorkoutSessionReadService {
  constructor(private readonly db: DatabaseService) {}

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

  async listSessions(
    userId: string,
    params: {
      status?: WorkoutSessionStatus;
      routineId?: string;
      from?: string;
      to?: string;
      q?: string;
      cursor?: string;
      limit?: number;
      sort?:
        | 'finishedAt:desc'
        | 'finishedAt:asc'
        | 'startedAt:desc'
        | 'startedAt:asc';
    },
  ) {
    const take = Math.min(Math.max(params.limit ?? 20, 1), 50) + 1;
    const where: Prisma.WorkoutSessionWhereInput = {
      userId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.routineId ? { routineId: params.routineId } : {}),
    };

    const useStarted = params.status === WorkoutSessionStatus.IN_PROGRESS;
    const gte = params.from ? new Date(params.from) : undefined;
    const lte = params.to ? new Date(params.to) : undefined;

    if (gte || lte) {
      if (useStarted) {
        where.startedAt = {
          ...(where.startedAt as Prisma.DateTimeFilter),
          ...(gte ? { gte } : {}),
          ...(lte ? { lte } : {}),
        };
      } else {
        where.endedAt = {
          ...(where.endedAt as Prisma.DateTimeFilter),
          ...(gte ? { gte } : {}),
          ...(lte ? { lte } : {}),
        };
      }
    }

    if (params.q) {
      where.notes = {
        contains: params.q,
        mode: 'insensitive',
      } as Prisma.StringNullableFilter;
    }

    let orderBy: Prisma.WorkoutSessionOrderByWithRelationInput[] = [];
    switch (params.sort) {
      case 'finishedAt:asc':
        orderBy = [{ endedAt: 'asc' }, { id: 'asc' }];
        break;
      case 'startedAt:asc':
        orderBy = [{ startedAt: 'asc' }, { id: 'asc' }];
        break;
      case 'startedAt:desc':
        orderBy = [{ startedAt: 'desc' }, { id: 'desc' }];
        break;
      case 'finishedAt:desc':
      default:
        orderBy = [{ endedAt: 'desc' }, { id: 'desc' }];
        break;
    }

    const list = await this.db.workoutSession.findMany({
      where,
      orderBy,
      take,
      skip: params.cursor ? 1 : 0,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      select: WORKOUT_SESSION_LIST_SELECT,
    });

    const hasNext = list.length === take;
    const items = (hasNext ? list.slice(0, -1) : list).map((session) => ({
      id: session.id,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
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
}
