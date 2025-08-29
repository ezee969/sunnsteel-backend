import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkoutSessionStatus } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { StartWorkoutDto } from './dto/start-workout.dto';
import { FinishWorkoutDto, FinishStatusDto } from './dto/finish-workout.dto';
import { UpsertSetLogDto } from './dto/upsert-set-log.dto';

// Narrow unknown error objects that include a Prisma error code
const isPrismaErrorWithCode = (e: unknown): e is { code: string } => {
  if (typeof e !== 'object' || e === null) return false;
  const maybe = e as { code?: unknown };
  return typeof maybe.code === 'string';
};

@Injectable()
export class WorkoutsService {
  constructor(private readonly db: DatabaseService) {}

  async getActiveSession(userId: string) {
    return this.db.workoutSession.findFirst({
      where: { userId, status: WorkoutSessionStatus.IN_PROGRESS },
      orderBy: { startedAt: 'desc' },
      select: this.sessionSelect(),
    });
  }

  async getSessionById(userId: string, id: string) {
    const session = await this.db.workoutSession.findFirst({
      where: { id, userId },
      select: this.sessionSelect(true),
    });

    if (!session) {
      throw new NotFoundException('Workout session not found');
    }

    return session;
  }

  async startSession(userId: string, dto: StartWorkoutDto) {
    // Ensure no other active session exists
    const active = await this.getActiveSession(userId);
    if (active) {
      throw new BadRequestException(
        'You already have an active workout session',
      );
    }

    // Validate routine and day ownership/relationship
    const routineDay = await this.db.routineDay.findFirst({
      where: { id: dto.routineDayId, routine: { id: dto.routineId, userId } },
      select: { id: true, routineId: true },
    });
    if (!routineDay) {
      throw new NotFoundException(
        'Routine day not found for this user/routine',
      );
    }

    const created = await this.db.workoutSession.create({
      data: {
        userId,
        routineId: dto.routineId,
        routineDayId: dto.routineDayId,
        status: WorkoutSessionStatus.IN_PROGRESS,
        notes: dto.notes,
      },
      select: this.sessionSelect(),
    });

    return created;
  }

  async finishSession(userId: string, id: string, dto: FinishWorkoutDto) {
    const session = await this.db.workoutSession.findFirst({
      where: { id, userId },
      select: { id: true, startedAt: true, status: true, routineDayId: true },
    });
    if (!session) {
      throw new NotFoundException('Workout session not found');
    }
    if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Only in-progress sessions can be finished',
      );
    }

    const now = new Date();
    const durationSec = Math.max(
      0,
      Math.round(
        (now.getTime() - new Date(session.startedAt).getTime()) / 1000,
      ),
    );

    const status =
      dto.status === FinishStatusDto.ABORTED
        ? WorkoutSessionStatus.ABORTED
        : WorkoutSessionStatus.COMPLETED;

    // Apply progression only when completed
    if (status === WorkoutSessionStatus.COMPLETED) {
      try {
        // Fetch routine configuration for this day
        const routineDay = await this.db.routineDay.findFirst({
          where: { id: session.routineDayId },
          select: {
            id: true,
            exercises: {
              select: {
                id: true,
                progressionScheme: true,
                minWeightIncrement: true,
                sets: {
                  select: {
                    setNumber: true,
                    repType: true,
                    reps: true,
                    minReps: true,
                    maxReps: true,
                    weight: true,
                  },
                  orderBy: { setNumber: 'asc' },
                },
              },
            },
          },
        });

        // Fetch performed set logs for this session
        const logs = await this.db.setLog.findMany({
          where: { sessionId: session.id },
          select: {
            routineExerciseId: true,
            setNumber: true,
            reps: true,
            isCompleted: true,
          },
        });

        const logKey = (reId: string, setNumber: number) =>
          `${reId}#${setNumber}`;
        const logMap = new Map<
          string,
          { reps: number | null; isCompleted: boolean }
        >();
        for (const l of logs) {
          logMap.set(logKey(l.routineExerciseId, l.setNumber), {
            reps: l.reps ?? null,
            isCompleted: l.isCompleted,
          });
        }

        const updates: Array<{
          routineExerciseId: string;
          setNumber: number;
          newWeight: number;
        }> = [];

        const targetFor = (set: {
          repType: 'FIXED' | 'RANGE';
          reps: number | null;
          minReps: number | null;
          maxReps: number | null;
        }) => {
          if (set.repType === 'RANGE') return set.maxReps ?? null;
          return set.reps ?? null;
        };

        for (const ex of routineDay?.exercises ?? []) {
          const scheme = ex.progressionScheme;
          const inc = ex.minWeightIncrement ?? 2.5;

          if (scheme === 'DOUBLE_PROGRESSION') {
            // progress if ALL sets hit or exceed target
            let allHit = true;
            for (const s of ex.sets) {
              const log = logMap.get(logKey(ex.id, s.setNumber));
              const target = targetFor({
                repType: s.repType as any,
                reps: (s as any).reps ?? null,
                minReps: (s as any).minReps ?? null,
                maxReps: (s as any).maxReps ?? null,
              });
              const reps = log?.reps ?? null;
              const hit =
                typeof target === 'number' &&
                typeof reps === 'number' &&
                reps >= target;
              if (!hit) {
                allHit = false;
                break;
              }
            }
            if (allHit) {
              for (const s of ex.sets) {
                const current = typeof s.weight === 'number' ? s.weight : 0;
                updates.push({
                  routineExerciseId: ex.id,
                  setNumber: s.setNumber,
                  newWeight: current + inc,
                });
              }
            }
          } else if (scheme === 'DYNAMIC_DOUBLE_PROGRESSION') {
            for (const s of ex.sets) {
              const log = logMap.get(logKey(ex.id, s.setNumber));
              const target = targetFor({
                repType: s.repType as any,
                reps: (s as any).reps ?? null,
                minReps: (s as any).minReps ?? null,
                maxReps: (s as any).maxReps ?? null,
              });
              const reps = log?.reps ?? null;
              const hit =
                typeof target === 'number' &&
                typeof reps === 'number' &&
                reps >= target;
              if (hit) {
                const current = typeof s.weight === 'number' ? s.weight : 0;
                updates.push({
                  routineExerciseId: ex.id,
                  setNumber: s.setNumber,
                  newWeight: current + inc,
                });
              }
            }
          }
        }

        // Apply updates
        await Promise.all(
          updates.map((u) =>
            this.db.routineExerciseSet.update({
              where: {
                routineExerciseId_setNumber: {
                  routineExerciseId: u.routineExerciseId,
                  setNumber: u.setNumber,
                },
              },
              data: { weight: u.newWeight },
              select: { id: true },
            }),
          ),
        );
      } catch {
        // Fail-safe: do not block finishing if progression cannot be computed
      }
    }

    return this.db.workoutSession.update({
      where: { id },
      data: { status, endedAt: now, durationSec, notes: dto.notes },
      select: this.sessionSelect(),
    });
  }

  async upsertSetLog(userId: string, sessionId: string, dto: UpsertSetLogDto) {
    // Validate session ownership and status
    const session = await this.db.workoutSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, status: true, routineDayId: true },
    });
    if (!session) {
      throw new NotFoundException('Workout session not found');
    }
    if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Cannot modify set logs for a finished session',
      );
    }

    // Validate routineExercise belongs to the session's routineDay
    const routineExercise = await this.db.routineExercise.findFirst({
      where: { id: dto.routineExerciseId, routineDayId: session.routineDayId },
      select: { id: true, exerciseId: true },
    });
    if (!routineExercise) {
      throw new BadRequestException(
        'Routine exercise does not belong to this session',
      );
    }

    // Validate provided exerciseId matches routineExercise.exerciseId
    if (dto.exerciseId !== routineExercise.exerciseId) {
      throw new BadRequestException(
        'exerciseId does not match routine exercise',
      );
    }

    const completedAt = dto.isCompleted ? new Date() : undefined;

    const where = {
      sessionId_routineExerciseId_setNumber: {
        sessionId,
        routineExerciseId: dto.routineExerciseId,
        setNumber: dto.setNumber,
      },
    } as const;

    const upserted = await this.db.setLog.upsert({
      where,
      update: {
        reps: dto.reps,
        weight: dto.weight,
        rpe: dto.rpe,
        isCompleted: dto.isCompleted ?? undefined,
        completedAt: dto.isCompleted === undefined ? undefined : completedAt,
        exerciseId: dto.exerciseId,
      },
      create: {
        sessionId,
        routineExerciseId: dto.routineExerciseId,
        exerciseId: dto.exerciseId,
        setNumber: dto.setNumber,
        reps: dto.reps,
        weight: dto.weight,
        rpe: dto.rpe,
        isCompleted: dto.isCompleted ?? false,
        completedAt: dto.isCompleted ? new Date() : undefined,
      },
      select: {
        id: true,
        sessionId: true,
        routineExerciseId: true,
        exerciseId: true,
        setNumber: true,
        reps: true,
        weight: true,
        rpe: true,
        isCompleted: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return upserted;
  }

  async deleteSetLog(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
    setNumber: number,
  ) {
    // Validate session ownership and status
    const session = await this.db.workoutSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, status: true },
    });
    if (!session) {
      throw new NotFoundException('Workout session not found');
    }
    if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Cannot modify set logs for a finished session',
      );
    }

    try {
      const deleted = await this.db.setLog.delete({
        where: {
          sessionId_routineExerciseId_setNumber: {
            sessionId,
            routineExerciseId,
            setNumber,
          },
        },
        select: { id: true },
      });
      return deleted;
    } catch (err: unknown) {
      // P2025 = Record not found
      if (isPrismaErrorWithCode(err) && err.code === 'P2025') {
        throw new NotFoundException('Set log not found');
      }
      throw err;
    }
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
    const take = Math.min(Math.max(params.limit ?? 20, 1), 50) + 1; // fetch one extra to detect next
    const where: Prisma.WorkoutSessionWhereInput = {
      userId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.routineId ? { routineId: params.routineId } : {}),
    };

    // Date range: prefer endedAt when finished, otherwise startedAt
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

    // Basic text search: notes contains (case-insensitive)
    if (params.q) {
      where.notes = {
        contains: params.q,
        mode: 'insensitive',
      } as Prisma.StringNullableFilter;
    }

    // Sorting
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
      select: {
        id: true,
        status: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
        notes: true,
        routine: { select: { id: true, name: true } },
        routineDay: { select: { dayOfWeek: true } },
      },
    });

    const hasNext = list.length === take;
    const items = (hasNext ? list.slice(0, -1) : list).map((s) => ({
      id: s.id,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSec: s.durationSec ?? undefined,
      notes: s.notes ?? undefined,
      // aggregates can be added later; keep optional for now
      totalVolume: undefined,
      totalSets: undefined,
      totalExercises: undefined,
      routine: {
        id: s.routine.id,
        name: s.routine.name,
        dayName: this.dayNameFrom(s.routineDay.dayOfWeek),
      },
    }));

    return {
      items,
      nextCursor: hasNext ? items[items.length - 1]?.id : undefined,
    };
  }

  private dayNameFrom(dayOfWeek: number): string {
    const names = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    return names[dayOfWeek] ?? '';
  }

  private sessionSelect(includeLogs = false) {
    return {
      id: true,
      userId: true,
      routineId: true,
      routineDayId: true,
      status: true,
      startedAt: true,
      endedAt: true,
      durationSec: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      routine: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      routineDay: {
        select: {
          id: true,
          dayOfWeek: true,
          exercises: {
            select: {
              id: true,
              order: true,
              restSeconds: true,
              progressionScheme: true,
              minWeightIncrement: true,
              exercise: {
                select: {
                  id: true,
                  name: true,
                  primaryMuscle: true,
                  equipment: true,
                },
              },
              sets: {
                select: {
                  id: true,
                  setNumber: true,
                  repType: true,
                  reps: true,
                  minReps: true,
                  maxReps: true,
                  weight: true,
                },
                orderBy: { setNumber: 'asc' },
              },
            },
            orderBy: { order: 'asc' },
          },
        },
      },
      ...(includeLogs
        ? {
            setLogs: {
              select: {
                id: true,
                routineExerciseId: true,
                exerciseId: true,
                setNumber: true,
                reps: true,
                weight: true,
                rpe: true,
                isCompleted: true,
                completedAt: true,
                createdAt: true,
                updatedAt: true,
                exercise: {
                  select: {
                    id: true,
                    name: true,
                    primaryMuscle: true,
                    equipment: true,
                  },
                },
              },
              orderBy: [
                { routineExerciseId: Prisma.SortOrder.asc },
                { setNumber: Prisma.SortOrder.asc },
              ],
            },
          }
        : {}),
    } as const;
  }
}
