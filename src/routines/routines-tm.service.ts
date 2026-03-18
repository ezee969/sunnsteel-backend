import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  IRtfWeekGoalsCacheAsync,
  RTF_WEEK_GOALS_CACHE,
} from '../cache/rtf-week-goals-cache.async';
import {
  CreateTmEventDto,
  TmEventResponseDto,
  TmEventSummaryDto,
} from './dto/tm-adjustment.dto';

@Injectable()
export class RoutinesTmService {
  private readonly logger = new Logger(RoutinesTmService.name);

  private readonly metrics = {
    tmAdjustmentsCreated: 0,
    tmGuardrailRejections: 0,
    tmUnknownExerciseRejections: 0,
    tmOwnershipOrProgramRejections: 0,
  };

  constructor(
    private readonly db: DatabaseService,
    @Inject(RTF_WEEK_GOALS_CACHE)
    private readonly rtfCache: IRtfWeekGoalsCacheAsync,
  ) {}

  getInternalMetrics() {
    return { ...this.metrics };
  }

  async createTmAdjustment(
    userId: string,
    routineId: string,
    dto: CreateTmEventDto,
  ): Promise<TmEventResponseDto> {
    const routine = await this.db.routine.findFirst({
      where: {
        id: routineId,
        userId,
        days: {
          some: {
            exercises: {
              some: {
                OR: [{ progressionScheme: 'PROGRAMMED_RTF' }],
              },
            },
          },
        },
      },
      select: {
        id: true,
        programStyle: true,
        days: {
          select: {
            exercises: {
              where: {
                exerciseId: dto.exerciseId,
                progressionScheme: 'PROGRAMMED_RTF',
              },
              select: { id: true },
            },
          },
        },
      },
    });

    if (!routine) {
      this.metrics.tmOwnershipOrProgramRejections++;
      throw new NotFoundException(
        'Routine not found, not accessible, or does not use RTF progression schemes',
      );
    }

    const hasExercise = routine.days.some((day) =>
      day.exercises.some((exercise) => exercise.id),
    );

    if (!hasExercise) {
      this.metrics.tmUnknownExerciseRejections++;
      throw new BadRequestException(
        'Exercise not found in routine or does not use RTF progression schemes',
      );
    }

    const calculatedPost = dto.preTmKg + dto.deltaKg;
    const epsilon = 0.01;
    if (Math.abs(calculatedPost - dto.postTmKg) > epsilon) {
      this.metrics.tmGuardrailRejections++;
      throw new BadRequestException('preTmKg + deltaKg must equal postTmKg');
    }

    const maxAbsPercent = 0.2;
    if (dto.preTmKg > 0) {
      const percent = Math.abs(dto.deltaKg) / dto.preTmKg;
      if (percent > maxAbsPercent) {
        this.metrics.tmGuardrailRejections++;
        throw new BadRequestException(
          'deltaKg exceeds 20% of preTmKg (guardrail)',
        );
      }
    }

    if (Math.abs(dto.deltaKg) > 25) {
      this.metrics.tmGuardrailRejections++;
      throw new BadRequestException(
        'deltaKg absolute change too large (guardrail)',
      );
    }

    if (dto.reason && dto.reason.length > 240) {
      this.metrics.tmGuardrailRejections++;
      throw new BadRequestException('reason too long (max 240 chars)');
    }

    const adjustment = await this.db.tmAdjustment.create({
      data: {
        routineId,
        exerciseId: dto.exerciseId,
        weekNumber: dto.weekNumber,
        deltaKg: dto.deltaKg,
        preTmKg: dto.preTmKg,
        postTmKg: dto.postTmKg,
        reason: dto.reason,
        style: routine.programStyle,
      },
    });
    this.metrics.tmAdjustmentsCreated++;

    try {
      await this.rtfCache.invalidateRoutine(routineId);
      await this.rtfCache.delete(`weekGoals:${routineId}:${dto.weekNumber}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown cache invalidation error';
      this.logger.warn(
        `RtF cache invalidation failed for routine ${routineId}: ${message}`,
      );
    }

    const exercise = await this.db.exercise.findUnique({
      where: { id: dto.exerciseId },
      select: { name: true },
    });

    return {
      id: adjustment.id,
      routineId,
      exerciseId: adjustment.exerciseId,
      exerciseName: exercise?.name ?? 'Unknown Exercise',
      weekNumber: adjustment.weekNumber,
      deltaKg: adjustment.deltaKg,
      preTmKg: adjustment.preTmKg,
      postTmKg: adjustment.postTmKg,
      reason: adjustment.reason ?? undefined,
      style: adjustment.style as 'STANDARD' | 'HYPERTROPHY' | null,
      createdAt: adjustment.createdAt.toISOString(),
    };
  }

  async getTmAdjustments(
    userId: string,
    routineId: string,
    exerciseId?: string,
    minWeek?: number,
    maxWeek?: number,
  ): Promise<TmEventResponseDto[]> {
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: { id: true },
    });

    if (!routine) {
      throw new NotFoundException('Routine not found or not accessible');
    }

    const weekFilter =
      minWeek || maxWeek
        ? {
            ...(minWeek ? { gte: minWeek } : {}),
            ...(maxWeek ? { lte: maxWeek } : {}),
          }
        : undefined;

    const adjustments = await this.db.tmAdjustment.findMany({
      where: {
        routineId,
        ...(exerciseId ? { exerciseId } : {}),
        ...(weekFilter ? { weekNumber: weekFilter } : {}),
      },
      orderBy: [{ weekNumber: 'desc' }, { createdAt: 'desc' }],
    });

    const exerciseIds = Array.from(
      new Set(adjustments.map((adjustment) => adjustment.exerciseId)),
    );
    const exercises = exerciseIds.length
      ? await this.db.exercise.findMany({
          where: { id: { in: exerciseIds } },
          select: { id: true, name: true },
        })
      : [];
    const exerciseNameById = new Map(exercises.map((exercise) => [exercise.id, exercise.name]));

    return adjustments.map((adjustment) => ({
      id: adjustment.id,
      routineId,
      exerciseId: adjustment.exerciseId,
      exerciseName:
        exerciseNameById.get(adjustment.exerciseId) ?? 'Unknown Exercise',
      weekNumber: adjustment.weekNumber,
      deltaKg: adjustment.deltaKg,
      preTmKg: adjustment.preTmKg,
      postTmKg: adjustment.postTmKg,
      reason: adjustment.reason ?? undefined,
      style: adjustment.style as 'STANDARD' | 'HYPERTROPHY' | null,
      createdAt: adjustment.createdAt.toISOString(),
    }));
  }

  async getTmAdjustmentSummary(
    userId: string,
    routineId: string,
  ): Promise<TmEventSummaryDto[]> {
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: { id: true },
    });

    if (!routine) {
      throw new NotFoundException('Routine not found or not accessible');
    }

    const summary = await this.db.tmAdjustment.groupBy({
      by: ['exerciseId'],
      where: { routineId },
      _count: { id: true },
      _sum: { deltaKg: true },
      _avg: { deltaKg: true },
      _max: { createdAt: true },
    });

    const exerciseIds = summary.map((item) => item.exerciseId);
    const exercises = exerciseIds.length
      ? await this.db.exercise.findMany({
          where: { id: { in: exerciseIds } },
          select: { id: true, name: true },
        })
      : [];
    const exerciseMap = new Map(exercises.map((exercise) => [exercise.id, exercise.name]));

    return summary.map((item) => ({
      exerciseId: item.exerciseId,
      exerciseName: exerciseMap.get(item.exerciseId) || 'Unknown Exercise',
      adjustmentCount: item._count.id,
      totalDeltaKg: item._sum.deltaKg || 0,
      averageDeltaKg: item._avg.deltaKg || 0,
      lastAdjustmentDate: item._max.createdAt?.toISOString() || null,
    }));
  }
}
