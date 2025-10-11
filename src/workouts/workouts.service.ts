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
import {
  IRtfWeekGoalsCacheAsync,
  RTF_WEEK_GOALS_CACHE,
} from '../cache/rtf-week-goals-cache.async';
import {
  RTF_STANDARD_WITH_DELOADS,
  RTF_HYPERTROPHY_WITH_DELOADS,
} from './rtf-schedules';
import { Inject } from '@nestjs/common';
import { StartWorkoutDto } from './dto/start-workout.dto';
import { StartWorkoutResponseDto } from './dto/start-workout-response.dto';
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
  constructor(
    private readonly db: DatabaseService,
    @Inject(RTF_WEEK_GOALS_CACHE)
    private readonly rtfCache: IRtfWeekGoalsCacheAsync,
  ) {}
  /**
   * Heartbeat utility to bump lastActivityAt timestamp. Silent on failure
   * so it never blocks the primary mutation path.
   */
  private async heartbeatSession(sessionId: string) {
    try {
      await this.db.workoutSession.update({
        where: { id: sessionId },
        data: { lastActivityAt: new Date() },
        select: { id: true },
      });
    } catch {}
  } // --- Payload Versioning (RTF-B05) ---
  // Increment this when the shape of week goals or timeline responses changes
  private static readonly RTF_WEEK_GOALS_VERSION = 1;

  // --- RtF Cache Abstraction (RTF-B04 Phase 1) ---
  private cacheKey(routineId: string, week: number) {
    return `weekGoals:${routineId}:${week}`;
  }
  private forecastCacheKey(routineId: string, remainingOnly = false) {
    const suffix = remainingOnly ? ':rem' : '';
    return `forecast:${routineId}:v${WorkoutsService.RTF_WEEK_GOALS_VERSION}${suffix}`;
  }
  private async cacheGet(key: string) {
    return this.rtfCache.get(key);
  }
  private async cacheSet(key: string, value: any) {
    await this.rtfCache.set(key, value);
  }

  // --- Metrics (RTF-B07 incremental) ---
  private metrics = {
    stampedeWaits: 0,
    stampedeBypass: 0,
    forecastSets: 0,
    forecastHits: 0,
    forecastMisses: 0,
    weekGoalsSets: 0,
    weekGoalsHits: 0,
    weekGoalsMisses: 0,
    startedAt: Date.now(),
  };

  getInternalMetrics() {
    const uptimeMs = Date.now() - this.metrics.startedAt;
    return { ...this.metrics, uptimeMs };
  }

  // Stampede protection: track in-flight computations keyed by cache key
  private static inFlight = new Map<string, Promise<any>>();
  private async withStampedeProtection<T>(
    key: string,
    factory: () => Promise<T>,
  ): Promise<T> {
    if (WorkoutsService.inFlight.has(key)) {
      // Another request already computing this key
      this.metrics.stampedeWaits++;
      return WorkoutsService.inFlight.get(key) as Promise<T>;
    }
    this.metrics.stampedeBypass++;
    const p = factory().finally(() => {
      WorkoutsService.inFlight.delete(key);
    });
    WorkoutsService.inFlight.set(key, p as Promise<any>);
    return p;
  }

  // --- RtF weekly goals (with deloads) ---
  // We now maintain TWO canonical schedules mirroring the frontend `reps-to-failure.ts` logic.
  // STANDARD: strength leaning (lower reps, broader intensity ramp, 5 sets total, AMRAP on set 5)
  // HYPERTROPHY: higher rep emphasis (moderate intensities, 4 sets total, AMRAP on set 4)
  // Deload weeks (7,14,21) differ: standard -> 3x5 @ ~60% TM (RPE6 implicit), hypertrophy -> 4x5 @ 60% TM.
  // NOTE: If programWithDeloads === false we strip deload weeks and reindex weeks logically (same as frontend approach).

  // Schedules moved to shared module rtf-schedules.ts (RTF-B09)

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

  private getRtFGoalForWeek(
    week: number,
    withDeloads: boolean,
    variant: 'STANDARD' | 'HYPERTROPHY',
  ) {
    const source =
      variant === 'HYPERTROPHY'
        ? RTF_HYPERTROPHY_WITH_DELOADS
        : RTF_STANDARD_WITH_DELOADS;
    if (withDeloads) return source[week - 1];
    const trainingOnly = source.filter(
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

  /**
   * Start a workout session if none active; if one already exists, return it with a reuse flag.
   * Concurrency:
   *  - Partial unique index (status=IN_PROGRESS) in DB guarantees invariant
   *  - We avoid a UX-level 400 by returning the existing session (idempotent semantics)
   *  - On race (P2002) we fetch the winner and return it.
   */
  async startSession(
    userId: string,
    dto: StartWorkoutDto,
  ): Promise<StartWorkoutResponseDto> {
    const preExisting = await this.getActiveSession(userId);
    if (preExisting) {
      return { ...(preExisting as any), reused: true };
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
        programStartWeek: true,
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

    let created: any;
    try {
      created = await this.db.workoutSession.create({
        data: {
          userId,
          routineId: dto.routineId,
          routineDayId: dto.routineDayId,
          status: WorkoutSessionStatus.IN_PROGRESS,
          notes: dto.notes,
        },
        select: this.sessionSelect(),
      });
      // Initial activity heartbeat (ignore failure)
      try {
        await this.heartbeatSession(created.id);
      } catch {}
    } catch (e: unknown) {
      if (isPrismaErrorWithCode(e) && e.code === 'P2002') {
        const existing = await this.getActiveSession(userId);
        if (existing) return { ...(existing as any), reused: true };
        throw new BadRequestException('Active workout session already exists');
      }
      throw e;
    }

    // Attach RtF plan for today if applicable
    if (hasProgram) {
      const tz = routine.programTimezone!;
      const offset = Math.max(0, (routine.programStartWeek ?? 1) - 1);
      const baseDuration = routine.programDurationWeeks!;
      const remainingWeeks = Math.max(1, baseDuration - offset);
      const relativeWeek = this.getCurrentProgramWeek(
        now,
        routine.programStartDate!,
        remainingWeeks,
        tz,
      );
      const week = relativeWeek + offset;
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
          programStyle: true,
          exercise: { select: { id: true, name: true } },
          order: true,
        },
        orderBy: { order: 'asc' },
      });

      const rtfExercises = exs
        ?.filter(
          (e) => e.progressionScheme === ProgressionScheme.PROGRAMMED_RTF,
        )
        .map((e) => {
          const variant: 'STANDARD' | 'HYPERTROPHY' =
            e.programStyle ?? 'STANDARD';
          const goal = this.getRtFGoalForWeek(week, withDeloads, variant);

          // Deload logic diverges in hypertrophy: 4 sets vs 3 sets (standard)
          if ((goal as any).isDeload) {
            const deload: any = goal;
            const intensity = deload.intensity ?? 0.6;
            const weightKg = this.roundToNearest(
              (e.programTMKg ?? 0) * intensity,
              e.programRoundingKg ?? 2.5,
            );
            if (variant === 'HYPERTROPHY') {
              const sets =
                deload.sets && deload.reps
                  ? Array.from({ length: deload.sets }, (_, i) => ({
                      setNumber: i + 1,
                      reps: deload.reps,
                      weightKg,
                    }))
                  : [
                      { setNumber: 1, reps: 5, weightKg },
                      { setNumber: 2, reps: 5, weightKg },
                      { setNumber: 3, reps: 5, weightKg },
                      { setNumber: 4, reps: 5, weightKg },
                    ];
              return {
                routineExerciseId: e.id,
                exerciseId: e.exercise.id,
                exerciseName: e.exercise.name,
                isDeload: true,
                variant,
                sets,
              } as const;
            }
            // STANDARD deload: fixed 3x5 @ ~60%
            return {
              routineExerciseId: e.id,
              exerciseId: e.exercise.id,
              exerciseName: e.exercise.name,
              isDeload: true,
              variant,
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

          if (variant === 'HYPERTROPHY') {
            // 4 total sets: (fixed reps) + AMRAP @ set 4
            return {
              routineExerciseId: e.id,
              exerciseId: e.exercise.id,
              exerciseName: e.exercise.name,
              isDeload: false,
              variant,
              weightKg,
              fixedReps: g.fixedReps,
              amrapTarget: g.amrapTarget,
              sets: [
                { setNumber: 1, reps: g.fixedReps, weightKg },
                { setNumber: 2, reps: g.fixedReps, weightKg },
                { setNumber: 3, reps: g.fixedReps, weightKg },
                {
                  setNumber: 4,
                  reps: null,
                  amrapTarget: g.amrapTarget,
                  weightKg,
                },
              ],
            } as const;
          }

          // STANDARD variant 5 sets
          return {
            routineExerciseId: e.id,
            exerciseId: e.exercise.id,
            exerciseName: e.exercise.name,
            isDeload: false,
            variant,
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
          durationWeeks: baseDuration,
          withDeloads,
          isDeloadWeek: isDeload,
          startDate: routine.programStartDate!,
          endDate: routine.programEndDate!,
          timeZone: tz,
        },
        rtfPlans: rtfExercises,
        reused: false,
      } as const;
    }

    return { ...created, reused: false } as const;
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
                programStartWeek: true,
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
                programStyle: true,
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
              orderBy: { order: 'asc' },
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
          const offset = Math.max(0, (routineProgram.programStartWeek ?? 1) - 1);
          const baseDuration = routineProgram.programDurationWeeks!;
          const remainingWeeks = Math.max(1, baseDuration - offset);
          const relativeWeek = this.getCurrentProgramWeek(
            new Date(),
            routineProgram.programStartDate!,
            remainingWeeks,
            tz,
          );
          currentWeek = relativeWeek + offset;
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
              // Adjust TM using AMRAP - set #5 for Standard RTF, set #4 for Hypertrophy RTF
              const amrapSetNumber = ex.programStyle === 'HYPERTROPHY' ? 4 : 5;
              const lastSet = logMap.get(logKey(ex.id, amrapSetNumber));
              if (
                typeof ex.programTMKg === 'number' &&
                typeof ex.programRoundingKg === 'number' &&
                lastSet?.reps != null &&
                ex.programLastAdjustedWeek !== currentWeek
              ) {
                const goal = this.getRtFGoalForWeek(
                  currentWeek,
                  !!routineProgram.programWithDeloads,
                  ex.programStyle ?? 'STANDARD',
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

    // Heartbeat update (non-blocking)
    await this.heartbeatSession(sessionId);

    return upserted;
  }

  /**
   * Public endpoint helper: expose RtF weekly goal details (intensity, fixed reps, AMRAP target)
   * for each PROGRAMMED_RTF exercise in a routine for a given
   * calendar program week. If no week provided the current program week is derived.
   */
  async getRtFWeekGoals(
    userId: string,
    routineId: string,
    requestedWeek?: number,
  ) {
    // Resolve week early if provided (cache key stability: use final week value)
    // We'll compute the actual week after loading the routine (needs duration bounds).
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: {
        id: true,
        programWithDeloads: true,
        programDurationWeeks: true,
        programStartWeek: true,
        programStartDate: true,
        programTimezone: true,
        days: {
          select: {
            exercises: {
              where: {
                progressionScheme: ProgressionScheme.PROGRAMMED_RTF,
              },
              select: {
                id: true,
                progressionScheme: true,
                programTMKg: true,
                programRoundingKg: true,
                programStyle: true,
                exercise: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!routine) throw new NotFoundException('Routine not found');
    if (
      !routine.programStartDate ||
      !routine.programDurationWeeks ||
      !routine.programTimezone
    ) {
      throw new BadRequestException('Routine does not have program data');
    }
    const withDeloads = !!routine.programWithDeloads;
    const offset = Math.max(0, (routine.programStartWeek ?? 1) - 1);
    const baseDuration = Number(routine.programDurationWeeks);
    const remainingWeeks = Math.max(1, baseDuration - offset);
    const week = requestedWeek
      ? requestedWeek
      : (() => {
          const rel = this.getCurrentProgramWeek(
            new Date(),
            routine.programStartDate,
            remainingWeeks,
            routine.programTimezone,
          );
          return rel + offset;
        })();
    if (week < 1 || week > routine.programDurationWeeks) {
      throw new BadRequestException('Week out of range');
    }
    const cacheKey = this.cacheKey(routineId, week);
    const cached = await this.cacheGet(cacheKey);
    if (cached) {
      this.metrics.weekGoalsHits++;
      return { ...cached, _cache: 'HIT' };
    }
    this.metrics.weekGoalsMisses++;
    return this.withStampedeProtection(cacheKey, async () => {
      const again = await this.cacheGet(cacheKey);
      if (again) return { ...again, _cache: 'HIT' };
      const goals: any[] = [];
      for (const day of routine.days) {
        for (const ex of day.exercises) {
          const variant: 'STANDARD' | 'HYPERTROPHY' =
            ex.programStyle ?? 'STANDARD';
          const goal = this.getRtFGoalForWeek(week, withDeloads, variant);
          const isDeload = (goal as any).isDeload === true;

          // Calculate working weight based on Training Max and intensity
          const tmKg = ex.programTMKg || 0;
          const roundingKg = ex.programRoundingKg || 2.5;
          const workingWeight = this.roundToNearest(
            tmKg * (goal as any).intensity,
            roundingKg,
          );

          if (isDeload) {
            if (variant === 'HYPERTROPHY') {
              const deload: any = goal;
              goals.push({
                routineExerciseId: ex.id,
                exerciseId: ex.exercise.id,
                exerciseName: ex.exercise.name,
                variant,
                week,
                isDeload: true,
                intensity: deload.intensity ?? 0.6,
                fixedReps: deload.reps ?? 5,
                setsPlanned: deload.sets ?? 4,
                amrapTarget: null,
                amrapSetNumber: null,
                workingWeightKg: this.roundToNearest(
                  tmKg * (deload.intensity ?? 0.6),
                  roundingKg,
                ),
                trainingMaxKg: tmKg,
              });
            } else {
              goals.push({
                routineExerciseId: ex.id,
                exerciseId: ex.exercise.id,
                exerciseName: ex.exercise.name,
                variant,
                week,
                isDeload: true,
                intensity: 0.6,
                fixedReps: 5,
                setsPlanned: 3,
                amrapTarget: null,
                amrapSetNumber: null,
                workingWeightKg: this.roundToNearest(tmKg * 0.6, roundingKg),
                trainingMaxKg: tmKg,
              });
            }
          } else {
            const g = goal as {
              intensity: number;
              fixedReps: number;
              amrapTarget: number;
            };
            goals.push({
              routineExerciseId: ex.id,
              exerciseId: ex.exercise.id,
              exerciseName: ex.exercise.name,
              variant,
              week,
              isDeload: false,
              intensity: g.intensity,
              fixedReps: g.fixedReps,
              setsPlanned: variant === 'HYPERTROPHY' ? 4 : 5,
              amrapTarget: g.amrapTarget,
              amrapSetNumber: variant === 'HYPERTROPHY' ? 4 : 5,
              workingWeightKg: workingWeight,
              trainingMaxKg: tmKg,
            });
          }
        }
      }
      const result = {
        routineId,
        week,
        withDeloads,
        goals,
        version: WorkoutsService.RTF_WEEK_GOALS_VERSION,
      };
      await this.cacheSet(cacheKey, result);
      this.metrics.weekGoalsSets++;
      return { ...result, _cache: 'MISS' };
    });
  }

  /**
   * Build full RtF timeline (all program weeks) for a routine.
   * Reuses per-week cache; aggregates results. (RTF-B03)
   */
  async getRtFTimeline(
    userId: string,
    routineId: string,
    remainingOnly = false,
  ) {
    // Fetch routine meta to know duration & deload setting
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: {
        id: true,
        programDurationWeeks: true,
        programWithDeloads: true,
        programStartDate: true,
        programTimezone: true,
        programStartWeek: true,
      },
    });
    if (!routine) throw new NotFoundException('Routine not found');
    if (!routine.programDurationWeeks) {
      throw new BadRequestException('Routine does not have program data');
    }
    const weeks = routine.programDurationWeeks;
    const timeline: any[] = [];
    let cacheHits = 0;
    const startWeek = remainingOnly
      ? Math.max(1, Number(routine.programStartWeek ?? 1))
      : 1;
    for (let w = startWeek; w <= weeks; w++) {
      const weekGoals = await this.getRtFWeekGoals(userId, routineId, w);
      if (weekGoals._cache === 'HIT') cacheHits++;
      timeline.push({ week: w, goals: weekGoals.goals });
    }
    return {
      routineId,
      weeks,
      version: WorkoutsService.RTF_WEEK_GOALS_VERSION,
      cacheStats: { hits: cacheHits, misses: weeks - cacheHits },
      fromWeek: remainingOnly ? startWeek : 1,
      timeline,
    };
  }

  /**
   * Forecast endpoint (RTF-B06): produce projected schedule summary for the
   * routine's remaining weeks (and all weeks) combining STANDARD + HYPERTROPHY
   * variants per exercise, incorporating deload mapping. We do not currently
   * adjust intensities for TM adjustments historically (future enhancement
   * could annotate weeks with delta events). Cached by routine/version.
   */
  async getRtFForecast(
    userId: string,
    routineId: string,
    remainingOnly = false,
  ) {
    const cacheKey = this.forecastCacheKey(routineId, remainingOnly);
    const cached = await this.cacheGet(cacheKey);
    if (cached) {
      this.metrics.forecastHits++;
      return { ...cached, _cache: 'HIT' };
    }
    this.metrics.forecastMisses++;
    return this.withStampedeProtection(cacheKey, async () => {
      const again = await this.cacheGet(cacheKey);
      if (again) {
        this.metrics.forecastHits++;
        return { ...again, _cache: 'HIT' };
      }
      const routine: any = await this.db.routine.findFirst({
        where: { id: routineId, userId },
        // Cast select as any to allow programRtfSnapshot (schema updated but
        // generated types may lag in some environments). Snapshot is optional.
        select: {
          id: true,
          programDurationWeeks: true,
          programWithDeloads: true,
          programStartDate: true,
          programTimezone: true,
          programStartWeek: true,
          programRtfSnapshot: true,
          days: {
            select: {
              exercises: {
                where: {
                  OR: [{ progressionScheme: ProgressionScheme.PROGRAMMED_RTF }],
                },
                select: {
                  id: true,
                  progressionScheme: true,
                  programStyle: true,
                  exercise: { select: { id: true, name: true } },
                },
              },
            },
          },
        } as any,
      });
      if (!routine) throw new NotFoundException('Routine not found');
      if (
        !routine.programDurationWeeks ||
        !routine.programStartDate ||
        !routine.programTimezone
      ) {
        throw new BadRequestException('Routine does not have program data');
      }
      const withDeloads = !!routine.programWithDeloads;
      const weeks: number = Number(routine.programDurationWeeks);
      const forecast: any[] = [];
      const snap: any | null = routine.programRtfSnapshot || null;
      const snapshotApplicable =
        !!snap &&
        snap.withDeloads === withDeloads &&
        Array.isArray(snap.standard) &&
        Array.isArray(snap.hypertrophy);
      const startWeek = remainingOnly
        ? Math.max(1, Number(routine.programStartWeek ?? 1))
        : 1;
      for (let w = startWeek; w <= weeks; w++) {
        const standard = snapshotApplicable
          ? ((snap.standard as any[])[w - 1] as {
              intensity: number;
              fixedReps: number;
              amrapTarget: number;
              isDeload?: boolean;
            })
          : this.getRtFGoalForWeek(w, withDeloads, 'STANDARD');
        const hypertrophy = snapshotApplicable
          ? ((snap.hypertrophy as any[])[w - 1] as {
              intensity: number;
              fixedReps: number;
              amrapTarget: number;
              isDeload?: boolean;
            })
          : this.getRtFGoalForWeek(w, withDeloads, 'HYPERTROPHY');
        const isDeload =
          ('isDeload' in standard && standard.isDeload) ||
          ('isDeload' in hypertrophy && hypertrophy.isDeload);
        forecast.push({
          week: w,
          isDeload: !!isDeload,
          standard: isDeload
            ? standard
            : {
                intensity: (standard as any).intensity,
                fixedReps: (standard as any).fixedReps,
                amrapTarget: (standard as any).amrapTarget,
                sets: 5,
                amrapSet: 5,
              },
          hypertrophy: isDeload
            ? hypertrophy
            : {
                intensity: (hypertrophy as any).intensity,
                fixedReps: (hypertrophy as any).fixedReps,
                amrapTarget: (hypertrophy as any).amrapTarget,
                sets: 4,
                amrapSet: 4,
              },
        });
      }
      const result = {
        routineId,
        weeks,
        version: WorkoutsService.RTF_WEEK_GOALS_VERSION,
        withDeloads,
        fromWeek: remainingOnly ? startWeek : 1,
        forecast,
      };
      await this.cacheSet(cacheKey, result);
      this.metrics.forecastSets++;
      return { ...result, _cache: 'MISS' };
    });
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
      // Heartbeat on delete (non-blocking)
      await this.heartbeatSession(sessionId);
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
      lastActivityAt: true,
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
