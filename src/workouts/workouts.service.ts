import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkoutSessionStatus,
  RepType,
  ProgressionScheme,
} from '@prisma/client';
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

  // --- RtF weekly goals (with deloads) adapted to 5 sets: 4 fixed + 1 AMRAP (set #5)
  // Weeks 7, 14, 21 are deloads (3x5 @ RPE6 @ ~60% TM)
  private readonly RTF_WITH_DELOADS: Array<
    | {
        week: number;
        intensity: number;
        fixedReps: number;
        amrapTarget: number;
      }
    | { week: number; isDeload: true }
  > = [
    { week: 1, intensity: 0.7, fixedReps: 5, amrapTarget: 10 },
    { week: 2, intensity: 0.75, fixedReps: 4, amrapTarget: 8 },
    { week: 3, intensity: 0.8, fixedReps: 3, amrapTarget: 6 },
    { week: 4, intensity: 0.725, fixedReps: 5, amrapTarget: 9 },
    { week: 5, intensity: 0.775, fixedReps: 4, amrapTarget: 7 },
    { week: 6, intensity: 0.825, fixedReps: 3, amrapTarget: 5 },
    { week: 7, isDeload: true },
    { week: 8, intensity: 0.75, fixedReps: 4, amrapTarget: 8 },
    { week: 9, intensity: 0.8, fixedReps: 3, amrapTarget: 6 },
    { week: 10, intensity: 0.85, fixedReps: 2, amrapTarget: 4 },
    { week: 11, intensity: 0.775, fixedReps: 4, amrapTarget: 7 },
    { week: 12, intensity: 0.825, fixedReps: 3, amrapTarget: 5 },
    { week: 13, intensity: 0.875, fixedReps: 2, amrapTarget: 3 },
    { week: 14, isDeload: true },
    { week: 15, intensity: 0.8, fixedReps: 3, amrapTarget: 6 },
    { week: 16, intensity: 0.85, fixedReps: 2, amrapTarget: 4 },
    { week: 17, intensity: 0.9, fixedReps: 1, amrapTarget: 2 },
    { week: 18, intensity: 0.85, fixedReps: 2, amrapTarget: 4 },
    { week: 19, intensity: 0.9, fixedReps: 1, amrapTarget: 2 },
    { week: 20, intensity: 0.95, fixedReps: 1, amrapTarget: 2 },
    { week: 21, isDeload: true },
  ];

  private localDateParts(d: Date, timeZone: string) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    const parts = fmt.formatToParts(d);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';
    const y = Number(get('year'));
    const m = Number(get('month'));
    const day = Number(get('day'));
    const wk = get('weekday'); // 'Sun'..'Sat'
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dow = map[wk] ?? 0;
    return { y, m, day, dow };
  }

  private diffLocalDays(a: Date, b: Date, timeZone: string) {
    const ap = this.localDateParts(a, timeZone);
    const bp = this.localDateParts(b, timeZone);
    const aUTC = Date.UTC(ap.y, ap.m - 1, ap.day);
    const bUTC = Date.UTC(bp.y, bp.m - 1, bp.day);
    return Math.floor((aUTC - bUTC) / 86_400_000);
  }

  private getCurrentProgramWeek(
    today: Date,
    programStartDate: Date,
    programDurationWeeks: number,
    timeZone: string,
  ) {
    const diffDays = this.diffLocalDays(today, programStartDate, timeZone);
    const week = Math.floor(diffDays / 7) + 1;
    if (week < 1) return 1;
    if (week > programDurationWeeks) return programDurationWeeks;
    return week;
  }

  private isDeloadWeek(week: number, withDeloads: boolean) {
    return withDeloads && (week === 7 || week === 14 || week === 21);
  }

  private getRtFGoalForWeek(week: number, withDeloads: boolean) {
    if (withDeloads) return this.RTF_WITH_DELOADS[week - 1];
    // 18-week mode: filter out deload entries
    const trainingOnly = this.RTF_WITH_DELOADS.filter(
      (g) => !('isDeload' in g && g.isDeload === true),
    ) as Array<{
      week: number;
      intensity: number;
      fixedReps: number;
      amrapTarget: number;
    }>;
    return trainingOnly[week - 1];
  }

  private roundToNearest(value: number, increment: number): number {
    if (!increment || increment <= 0) return value;
    return Math.round(value / increment) * increment;
  }

  private adjustTM(currentTM: number, repsDone: number, targetReps: number) {
    const diff = repsDone - targetReps;
    if (diff >= 5) return currentTM * 1.03;
    if (diff === 4) return currentTM * 1.02;
    if (diff === 3) return currentTM * 1.015;
    if (diff === 2) return currentTM * 1.01;
    if (diff === 1) return currentTM * 1.005;
    if (diff === 0) return currentTM;
    if (diff === -1) return currentTM * 0.98;
    return currentTM * 0.95; // diff <= -2
  }

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
      select: { id: true, routineId: true, dayOfWeek: true },
    });
    if (!routineDay) {
      throw new NotFoundException(
        'Routine day not found for this user/routine',
      );
    }

    // Load routine program configuration
    const routine = await this.db.routine.findFirst({
      where: { id: dto.routineId, userId },
      select: {
        programWithDeloads: true,
        programDurationWeeks: true,
        programStartDate: true,
        programEndDate: true,
        programTrainingDaysOfWeek: true,
        programTimezone: true,
      },
    });

    // If routine is date-driven (RtF configured), enforce schedule
    const now = new Date();
    const hasProgram =
      !!routine?.programStartDate &&
      !!routine?.programEndDate &&
      !!routine?.programDurationWeeks &&
      !!routine?.programTimezone &&
      Array.isArray(routine?.programTrainingDaysOfWeek) &&
      (routine?.programTrainingDaysOfWeek?.length ?? 0) > 0;

    if (hasProgram) {
      const tz = routine.programTimezone!;
      const dow = this.localDateParts(now, tz).dow; // 0..6
      const isScheduled = routine.programTrainingDaysOfWeek.includes(dow);

      // Date window checks (inclusive)
      const beforeStart =
        this.diffLocalDays(now, routine.programStartDate!, tz) < 0;
      const afterEnd = this.diffLocalDays(now, routine.programEndDate!, tz) > 0;
      if (beforeStart) {
        throw new BadRequestException('Program has not started yet');
      }
      if (afterEnd) {
        throw new BadRequestException('Program has ended');
      }
      if (!isScheduled) {
        throw new BadRequestException(
          'Today is not a scheduled training day for this routine',
        );
      }
      // Ensure the chosen routineDay matches today's weekday
      if (routineDay.dayOfWeek !== dow) {
        throw new BadRequestException(
          "Selected routine day does not match today's weekday",
        );
      }
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

    // Attach RtF plan for today if applicable
    if (hasProgram) {
      const tz = routine.programTimezone!;
      const week = this.getCurrentProgramWeek(
        now,
        routine.programStartDate!,
        routine.programDurationWeeks!,
        tz,
      );
      const withDeloads = !!routine.programWithDeloads;
      const isDeload = this.isDeloadWeek(week, withDeloads);

      // Load exercises for this routine day with RtF config
      const exs = await this.db.routineExercise.findMany({
        where: { routineDayId: routineDay.id },
        select: {
          id: true,
          progressionScheme: true,
          programTMKg: true,
          programRoundingKg: true,
          exercise: { select: { id: true, name: true } },
          order: true,
        },
        orderBy: { order: 'asc' },
      });

      const rtfPlans = exs
        .filter((e) => e.progressionScheme === ProgressionScheme.PROGRAMMED_RTF)
        .map((e) => {
          const goal = this.getRtFGoalForWeek(week, withDeloads);
          if ((goal as any).isDeload) {
            const weightKg = this.roundToNearest(
              (e.programTMKg ?? 0) * 0.6,
              e.programRoundingKg ?? 2.5,
            );
            return {
              routineExerciseId: e.id,
              exerciseId: e.exercise.id,
              exerciseName: e.exercise.name,
              isDeload: true,
              sets: [
                { setNumber: 1, reps: 5, rpe: 6, weightKg },
                { setNumber: 2, reps: 5, rpe: 6, weightKg },
                { setNumber: 3, reps: 5, rpe: 6, weightKg },
              ],
            } as const;
          }
          const g = goal as {
            intensity: number;
            fixedReps: number;
            amrapTarget: number;
          };
          const weightKg = this.roundToNearest(
            (e.programTMKg ?? 0) * g.intensity,
            e.programRoundingKg ?? 2.5,
          );
          return {
            routineExerciseId: e.id,
            exerciseId: e.exercise.id,
            exerciseName: e.exercise.name,
            isDeload: false,
            weightKg,
            fixedReps: g.fixedReps,
            amrapTarget: g.amrapTarget,
            sets: [
              { setNumber: 1, reps: g.fixedReps, weightKg },
              { setNumber: 2, reps: g.fixedReps, weightKg },
              { setNumber: 3, reps: g.fixedReps, weightKg },
              { setNumber: 4, reps: g.fixedReps, weightKg },
              {
                setNumber: 5,
                reps: null,
                amrapTarget: g.amrapTarget,
                weightKg,
              },
            ],
          } as const;
        });

      return {
        ...created,
        program: {
          currentWeek: week,
          durationWeeks: routine.programDurationWeeks!,
          withDeloads,
          isDeloadWeek: isDeload,
          startDate: routine.programStartDate!,
          endDate: routine.programEndDate!,
          timeZone: tz,
        },
        rtfPlans,
      } as const;
    }

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
            routine: {
              select: {
                programWithDeloads: true,
                programDurationWeeks: true,
                programStartDate: true,
                programEndDate: true,
                programTimezone: true,
              },
            },
            exercises: {
              select: {
                id: true,
                progressionScheme: true,
                minWeightIncrement: true,
                programTMKg: true,
                programRoundingKg: true,
                programLastAdjustedWeek: true,
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
          repType: RepType;
          reps: number | null | undefined;
          minReps: number | null | undefined;
          maxReps: number | null | undefined;
        }) => {
          if (set.repType === RepType.RANGE) return set.maxReps ?? null;
          return set.reps ?? null;
        };

        // RtF PROGRAMMED adjustments (per exercise instance, at most once per calendar week)
        const routineProgram = routineDay?.routine;
        const hasProgram =
          !!routineProgram?.programStartDate &&
          !!routineProgram?.programEndDate &&
          !!routineProgram?.programDurationWeeks &&
          !!routineProgram?.programTimezone;
        let currentWeek: number | null = null;
        let isDeload = false;
        if (hasProgram) {
          const tz = routineProgram.programTimezone!;
          currentWeek = this.getCurrentProgramWeek(
            new Date(),
            routineProgram.programStartDate!,
            routineProgram.programDurationWeeks!,
            tz,
          );
          isDeload = this.isDeloadWeek(
            currentWeek,
            !!routineProgram.programWithDeloads,
          );
        }

        for (const ex of routineDay?.exercises ?? []) {
          const scheme = ex.progressionScheme;
          const inc = ex.minWeightIncrement ?? 2.5;

          if (scheme === 'DOUBLE_PROGRESSION') {
            // progress if ALL sets hit or exceed target
            let allHit = true;
            for (const s of ex.sets) {
              const log = logMap.get(logKey(ex.id, s.setNumber));
              const target = targetFor({
                repType: s.repType,
                reps: s.reps ?? null,
                minReps: s.minReps ?? null,
                maxReps: s.maxReps ?? null,
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
                repType: s.repType,
                reps: s.reps ?? null,
                minReps: s.minReps ?? null,
                maxReps: s.maxReps ?? null,
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
          } else if (scheme === ProgressionScheme.PROGRAMMED_RTF) {
            if (hasProgram && currentWeek && !isDeload) {
              // Adjust TM using AMRAP (set #5) once per week per exercise instance
              const lastSet = logMap.get(logKey(ex.id, 5));
              if (
                typeof ex.programTMKg === 'number' &&
                typeof ex.programRoundingKg === 'number' &&
                lastSet?.reps != null &&
                ex.programLastAdjustedWeek !== currentWeek
              ) {
                const goal = this.getRtFGoalForWeek(
                  currentWeek,
                  !!routineProgram.programWithDeloads,
                );
                if (!('isDeload' in (goal as any))) {
                  const g = goal as {
                    intensity: number;
                    fixedReps: number;
                    amrapTarget: number;
                  };
                  const newTM = this.adjustTM(
                    ex.programTMKg,
                    lastSet.reps,
                    g.amrapTarget,
                  );
                  await this.db.routineExercise.update({
                    where: { id: ex.id },
                    data: {
                      programTMKg: newTM,
                      programLastAdjustedWeek: currentWeek,
                    },
                    select: { id: true },
                  });
                }
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
                  primaryMuscles: true,
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
                    primaryMuscles: true,
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
