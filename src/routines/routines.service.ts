import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProgressionScheme } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import {
  CreateTmEventDto,
  TmEventResponseDto,
  TmEventSummaryDto,
} from './dto/tm-adjustment.dto';
import { WorkoutsService } from '../workouts/workouts.service';
import {
  IRtfWeekGoalsCacheAsync,
  RTF_WEEK_GOALS_CACHE,
} from '../cache/rtf-week-goals-cache.async';
import { buildRtfProgramSnapshot } from '../workouts/rtf-schedules';
import { Inject } from '@nestjs/common';

@Injectable()
export class RoutinesService {
  constructor(
    private readonly db: DatabaseService,
    // Inject workouts service to leverage existing RtF weekly goal logic
    private readonly workoutsService: WorkoutsService,
    @Inject(RTF_WEEK_GOALS_CACHE)
    private readonly rtfCache: IRtfWeekGoalsCacheAsync,
  ) {}

  // --- Telemetry counters (RTF-B07 extension) ---
  private metrics = {
    tmAdjustmentsCreated: 0,
    tmGuardrailRejections: 0,
    tmUnknownExerciseRejections: 0,
    tmOwnershipOrProgramRejections: 0,
  };

  getInternalMetrics() {
    return { ...this.metrics };
  }

  // Helpers to work with calendar days in a given IANA timezone
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

  private addDays(dateOnly: Date, days: number) {
    const d = new Date(
      Date.UTC(
        dateOnly.getUTCFullYear(),
        dateOnly.getUTCMonth(),
        dateOnly.getUTCDate(),
      ),
    );
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  async create(userId: string, dto: CreateRoutineDto) {
    // Determine if any exercise uses PROGRAMMED_RTF
    const hasRtF = dto.days.some((d) =>
      d.exercises.some((e) => e.progressionScheme === 'PROGRAMMED_RTF'),
    );

    // Validate programStyle for PROGRAMMED_RTF exercises
    for (const day of dto.days) {
      for (const exercise of day.exercises) {
        if (
          exercise.progressionScheme === 'PROGRAMMED_RTF' &&
          !exercise.programStyle
        ) {
          throw new BadRequestException(
            'programStyle is required for PROGRAMMED_RTF exercises',
          );
        }
      }
    }

    // Prepare program fields (optional unless hasRtF)
    let programWithDeloads: boolean | null = null;
    let programDurationWeeks: number | null = null;
    let programStartDate: Date | null = null;
    let programEndDate: Date | null = null;
    let programTimezone: string | null = null;
    let programTrainingDaysOfWeek: number[] = [];
    let programStartWeek: number | null = null;
    let programStyle: 'STANDARD' | 'HYPERTROPHY' | null = null;

    if (hasRtF) {
      if (typeof dto.programWithDeloads !== 'boolean') {
        throw new BadRequestException(
          'programWithDeloads is required when using RTF progression schemes',
        );
      }
      if (!dto.programStartDate) {
        throw new BadRequestException(
          'programStartDate (yyyy-mm-dd) is required when using RTF progression schemes',
        );
      }
      if (!dto.programTimezone) {
        throw new BadRequestException(
          'programTimezone (IANA) is required when using RTF progression schemes',
        );
      }

      programWithDeloads = dto.programWithDeloads;
      programDurationWeeks = dto.programWithDeloads ? 21 : 18;
      programTimezone = dto.programTimezone;

      // Parse date-only string and create a date that represents the correct date in the user's timezone
      // We need to ensure the date validation uses the date as intended by the user
      const start = new Date(`${dto.programStartDate}T12:00:00.000Z`); // Use noon UTC to avoid timezone edge cases
      if (isNaN(start.getTime())) {
        throw new BadRequestException(
          'programStartDate must be an ISO date (yyyy-mm-dd)',
        );
      }

      // Validate weekday match with first training day
      const orderedDays = [...dto.days].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      );
      if (orderedDays.length === 0) {
        throw new BadRequestException(
          'Routine requires at least one training day when using RTF progression schemes',
        );
      }
      programTrainingDaysOfWeek = orderedDays.map((d) => d.dayOfWeek);
      const firstTrainingDow = programTrainingDaysOfWeek[0]; // 0..6
      const startDow = this.localDateParts(start, programTimezone).dow; // 0..6
      if (startDow !== firstTrainingDow) {
        throw new BadRequestException(
          'programStartDate must fall on the weekday of the first training day',
        );
      }

      programStartDate = start;
      if (dto.programStyle) {
        if (!['STANDARD', 'HYPERTROPHY'].includes(dto.programStyle)) {
          throw new BadRequestException(
            'programStyle must be STANDARD or HYPERTROPHY',
          );
        }
        programStyle = dto.programStyle;
      }
      // Clamp start week (create-only feature). Default to 1 when unset.
      const requestedStartWeek =
        typeof dto.programStartWeek === 'number' ? dto.programStartWeek : 1;
      const clampedStartWeek = Math.min(
        Math.max(requestedStartWeek, 1),
        programDurationWeeks,
      );
      programStartWeek = clampedStartWeek;
      // End date = last day of the remaining window from start week
      const remainingWeeks = programDurationWeeks - (clampedStartWeek - 1);
      const totalDays = remainingWeeks * 7 - 1;
      programEndDate = this.addDays(start, totalDays);
    }

    const snapshot = hasRtF
      ? buildRtfProgramSnapshot(!!programWithDeloads)
      : null;
    const routine = await this.db.routine.create({
      data: {
        user: {
          connect: {
            id: userId,
          },
        },
        name: dto.name,
        description: dto.description,
        isPeriodized: false,
        ...(hasRtF
          ? {
              programWithDeloads,
              programDurationWeeks,
              programStartWeek,
              programStartDate,
              programEndDate,
              programTrainingDaysOfWeek,
              programTimezone,
              programStyle,
              // Cast snapshot to any to satisfy Prisma JSON input typing (RTF-B09)
              programRtfSnapshot: snapshot as any,
            }
          : {
              programWithDeloads: null,
              programDurationWeeks: null,
              programStartWeek: null,
              programStartDate: null,
              programEndDate: null,
              programTrainingDaysOfWeek: [],
              programTimezone: null,
              programStyle: null,
              programRtfSnapshot: null as any,
            }),
        days: {
          create: dto.days.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            order: d.order ?? 0,
            exercises: {
              create: d.exercises.map((e) => ({
                exercise: { connect: { id: e.exerciseId } },
                order: e.order ?? 0,
                restSeconds: e.restSeconds,
                progressionScheme: e.progressionScheme ?? 'NONE',
                minWeightIncrement: e.minWeightIncrement ?? 2.5,
                ...(e.progressionScheme === 'PROGRAMMED_RTF'
                  ? {
                      programTMKg: e.programTMKg ?? undefined,
                      programRoundingKg: e.programRoundingKg ?? 2.5,
                      programStyle: e.programStyle ?? 'STANDARD',
                    }
                  : {}),
                sets: {
                  create: e.sets.map((s) => {
                    if (s.repType === 'RANGE') {
                      if (
                        typeof s.minReps !== 'number' ||
                        typeof s.maxReps !== 'number'
                      ) {
                        throw new BadRequestException(
                          'For RANGE repType, minReps and maxReps are required',
                        );
                      }
                      if (s.minReps > s.maxReps) {
                        throw new BadRequestException(
                          'minReps must be less than or equal to maxReps',
                        );
                      }
                    } else if (s.repType === 'FIXED') {
                      if (typeof s.reps !== 'number') {
                        throw new BadRequestException(
                          'For FIXED repType, reps is required',
                        );
                      }
                    }

                    const repTypeVal: 'RANGE' | 'FIXED' =
                      s.repType === 'RANGE' ? 'RANGE' : 'FIXED';
                    return {
                      setNumber: s.setNumber,
                      repType: repTypeVal,
                      weight: s.weight,
                      ...(repTypeVal === 'FIXED' && typeof s.reps === 'number'
                        ? { reps: s.reps }
                        : {}),
                      ...(repTypeVal === 'RANGE' &&
                      typeof s.minReps === 'number' &&
                      typeof s.maxReps === 'number'
                        ? { minReps: s.minReps, maxReps: s.maxReps }
                        : {}),
                    };
                  }),
                },
              })),
            },
          })),
        },
      },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        isPeriodized: true,
        isFavorite: true,
        isCompleted: true,
        programWithDeloads: true,
        programDurationWeeks: true,
        programStartWeek: true,
        programStartDate: true,
        programEndDate: true,
        programTrainingDaysOfWeek: true,
        programTimezone: true,
        programStyle: true,
        createdAt: true,
        updatedAt: true,
        days: {
          select: {
            id: true,
            dayOfWeek: true,
            order: true,
            exercises: {
              select: {
                id: true,
                order: true,
                restSeconds: true,
                progressionScheme: true,
                minWeightIncrement: true,
                programTMKg: true,
                programRoundingKg: true,
                programStyle: true,
                exercise: { select: { id: true, name: true } },
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
          orderBy: { order: 'asc' },
        },
      },
    });
    return routine;
  }

  async findAll(
    userId: string,
    filter?: { isFavorite?: boolean; isCompleted?: boolean },
  ) {
    const where: Record<string, any> = { userId };
    if (typeof filter?.isFavorite === 'boolean') {
      where.isFavorite = filter.isFavorite;
    }
    if (typeof filter?.isCompleted === 'boolean') {
      where.isCompleted = filter.isCompleted;
    }

    const routines = await this.db.routine.findMany({
      where,
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        isPeriodized: true,
        isFavorite: true,
        isCompleted: true,
        programWithDeloads: true,
        programDurationWeeks: true,
        programStartWeek: true,
        programStartDate: true,
        programEndDate: true,
        programTimezone: true,
        programStyle: true,
        createdAt: true,
        updatedAt: true,
        days: {
          select: {
            id: true,
            dayOfWeek: true,
            order: true,
            exercises: {
              select: {
                id: true,
                order: true,
                restSeconds: true,
                progressionScheme: true,
                minWeightIncrement: true,
                exercise: { select: { id: true, name: true } },
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
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return routines;
  }

  async findOne(
    userId: string,
    id: string,
    options?: { includeRtFGoals?: boolean; week?: number },
  ) {
    const routine = await this.db.routine.findFirst({
      where: { id, userId },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        isPeriodized: true,
        isFavorite: true,
        isCompleted: true,
        programWithDeloads: true,
        programDurationWeeks: true,
        programStartWeek: true,
        programStartDate: true,
        programEndDate: true,
        programTimezone: true,
        programStyle: true,
        createdAt: true,
        updatedAt: true,
        days: {
          select: {
            id: true,
            dayOfWeek: true,
            order: true,
            exercises: {
              select: {
                id: true,
                order: true,
                restSeconds: true,
                progressionScheme: true,
                minWeightIncrement: true,
                programTMKg: true,
                programRoundingKg: true,
                exercise: { select: { id: true, name: true } },
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
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!routine) {
      throw new NotFoundException('Routine not found');
    }

    // Optionally attach RtF weekly goals (RTF-B02)
    if (options?.includeRtFGoals) {
      try {
        const week = options.week;
        const goals = await this.workoutsService.getRtFWeekGoals(
          userId,
          id,
          week,
        );
        return { ...routine, rtfGoals: goals };
      } catch (err) {
        // If routine lacks program data or other validation errors, surface as-is
        // (frontend can decide how to present). We only silence NOT_FOUND to keep
        // parity with base routine fetch semantics.
        if (err instanceof NotFoundException) {
          return routine;
        }
        throw err;
      }
    }

    return routine;
  }

  async update(userId: string, id: string, dto: UpdateRoutineDto) {
    return this.db.$transaction(async (tx) => {
      // Verify ownership and fetch existing program fields for preservation logic
      const existing = await tx.routine.findFirst({
        where: { id, userId },
        select: {
          id: true,
          programWithDeloads: true,
          programDurationWeeks: true,
          programStartWeek: true,
          programStartDate: true,
          programEndDate: true,
          programTimezone: true,
          programTrainingDaysOfWeek: true,
        },
      });
      if (!existing) {
        throw new NotFoundException(
          'Routine not found or you do not have permission to edit it.',
        );
      }

      // First, delete any SetLogs that reference RoutineExercises in this routine
      await tx.setLog.deleteMany({
        where: {
          routineExercise: {
            routineDay: {
              routineId: id,
            },
          },
        },
      });

      // Remove current days (cascade removes exercises and sets)
      // Only delete and recreate days if days array is provided in the update
      if (dto.days) {
        await tx.routineDay.deleteMany({ where: { routineId: id } });
      }

      // Determine if any exercise uses PROGRAMMED_RTF
      const hasRtF = dto.days
        ? dto.days.some((d) =>
            d.exercises.some((e) => e.progressionScheme === 'PROGRAMMED_RTF'),
          )
        : false;

      // Validate programStyle for PROGRAMMED_RTF exercises in updates
      if (dto.days) {
        for (const day of dto.days) {
          for (const exercise of day.exercises) {
            if (
              exercise.progressionScheme === 'PROGRAMMED_RTF' &&
              !exercise.programStyle
            ) {
              throw new BadRequestException(
                'programStyle is required for PROGRAMMED_RTF exercises',
              );
            }
          }
        }
      }

      let programWithDeloads: boolean | null = null;
      let programDurationWeeks: number | null = null;
      let programStartWeek: number | null = null;
      let programStartDate: Date | null = null;
      let programEndDate: Date | null = null;
      let programTimezone: string | null = null;
      let programTrainingDaysOfWeek: number[] = [];
      let programStyle: 'STANDARD' | 'HYPERTROPHY' | null = null;

      if (hasRtF && dto.days) {
        if (typeof dto.programWithDeloads !== 'boolean') {
          throw new BadRequestException(
            'programWithDeloads is required when using RTF progression schemes',
          );
        }
        if (!dto.programStartDate) {
          throw new BadRequestException(
            'programStartDate (yyyy-mm-dd) is required when using RTF progression schemes',
          );
        }
        if (!dto.programTimezone) {
          throw new BadRequestException(
            'programTimezone (IANA) is required when using RTF progression schemes',
          );
        }

        programWithDeloads = dto.programWithDeloads;
        programDurationWeeks = dto.programWithDeloads ? 21 : 18;
        programTimezone = dto.programTimezone;
        const start = new Date(`${dto.programStartDate}T12:00:00.000Z`); // Use noon UTC to avoid timezone edge cases
        if (isNaN(start.getTime())) {
          throw new BadRequestException(
            'programStartDate must be an ISO date (yyyy-mm-dd)',
          );
        }

        const orderedDays = [...dto.days].sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0),
        );
        if (orderedDays.length === 0) {
          throw new BadRequestException(
            'Routine requires at least one training day when using RTF progression schemes',
          );
        }
        programTrainingDaysOfWeek = orderedDays.map((d) => d.dayOfWeek);
        const firstTrainingDow = programTrainingDaysOfWeek[0];
        const startDow = this.localDateParts(start, programTimezone).dow;
        if (startDow !== firstTrainingDow) {
          throw new BadRequestException(
            'programStartDate must fall on the weekday of the first training day',
          );
        }

        programStartDate = start;
        if (dto.programStyle) {
          if (!['STANDARD', 'HYPERTROPHY'].includes(dto.programStyle)) {
            throw new BadRequestException(
              'programStyle must be STANDARD or HYPERTROPHY',
            );
          }
          programStyle = dto.programStyle;
        }
        const baseUnchanged =
          existing.programStartDate &&
          existing.programStartDate.getUTCFullYear() ===
            start.getUTCFullYear() &&
          existing.programStartDate.getUTCMonth() === start.getUTCMonth() &&
          existing.programStartDate.getUTCDate() === start.getUTCDate() &&
          existing.programWithDeloads === dto.programWithDeloads;

        if (typeof (dto as any).programStartWeek === 'number') {
          const requestedStartWeek = (dto as any).programStartWeek as number;
          const clamped = Math.min(
            Math.max(requestedStartWeek, 1),
            programDurationWeeks,
          );
          programStartWeek = clamped;
          const remainingWeeks = programDurationWeeks - (clamped - 1);
          const totalDays = remainingWeeks * 7 - 1;
          programEndDate = this.addDays(start, totalDays);
        } else if (baseUnchanged) {
          // Preserve existing start week and end date if base inputs unchanged
          programStartWeek = existing.programStartWeek ?? 1;
          if (existing.programEndDate) {
            programEndDate = existing.programEndDate;
          } else {
            const totalDays = programDurationWeeks * 7 - 1;
            programEndDate = this.addDays(start, totalDays);
          }
        } else {
          // Reset to week 1 when base inputs changed and no explicit start week provided
          programStartWeek = 1;
          const totalDays = programDurationWeeks * 7 - 1;
          programEndDate = this.addDays(start, totalDays);
        }
      }

      const snapshot =
        hasRtF && dto.days
          ? buildRtfProgramSnapshot(!!programWithDeloads)
          : null;
      const updated = await tx.routine.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.programStyle !== undefined && {
            programStyle: dto.programStyle,
          }),
          isPeriodized: false,
          ...(hasRtF && dto.days
            ? {
                programWithDeloads,
                programDurationWeeks,
                programStartWeek,
                programStartDate,
                programEndDate,
                programTrainingDaysOfWeek,
                programTimezone,
                // Cast snapshot to any (Prisma JSON input) (RTF-B09)
                programRtfSnapshot: snapshot as any,
              }
            : dto.days && {
                programWithDeloads: null,
                programDurationWeeks: null,
                programStartWeek: null,
                programStartDate: null,
                programEndDate: null,
                programTrainingDaysOfWeek: [],
                programTimezone: null,
                programStyle: null,
                programRtfSnapshot: null as any,
              }),
          ...(dto.days && {
            days: {
              create: dto.days.map((d) => ({
                dayOfWeek: d.dayOfWeek,
                order: d.order ?? 0,
                exercises: {
                  create: d.exercises.map((e) => ({
                    exercise: { connect: { id: e.exerciseId } },
                    order: e.order ?? 0,
                    restSeconds: e.restSeconds,
                    progressionScheme: e.progressionScheme ?? 'NONE',
                    minWeightIncrement: e.minWeightIncrement ?? 2.5,
                    ...(e.progressionScheme === 'PROGRAMMED_RTF'
                      ? {
                          programTMKg: e.programTMKg ?? undefined,
                          programRoundingKg: e.programRoundingKg ?? 2.5,
                          programStyle: e.programStyle ?? 'STANDARD',
                        }
                      : {}),
                    sets: {
                      create: e.sets.map((s) => {
                        if (s.repType === 'RANGE') {
                          if (
                            typeof s.minReps !== 'number' ||
                            typeof s.maxReps !== 'number'
                          ) {
                            throw new BadRequestException(
                              'For RANGE repType, minReps and maxReps are required',
                            );
                          }
                          if (s.minReps > s.maxReps) {
                            throw new BadRequestException(
                              'minReps must be less than or equal to maxReps',
                            );
                          }
                        } else if (s.repType === 'FIXED') {
                          if (typeof s.reps !== 'number') {
                            throw new BadRequestException(
                              'For FIXED repType, reps is required',
                            );
                          }
                        }

                        const repTypeVal: 'RANGE' | 'FIXED' =
                          s.repType === 'RANGE' ? 'RANGE' : 'FIXED';
                        return {
                          setNumber: s.setNumber,
                          repType: repTypeVal,
                          weight: s.weight,
                          ...(repTypeVal === 'FIXED' &&
                          typeof s.reps === 'number'
                            ? { reps: s.reps }
                            : {}),
                          ...(repTypeVal === 'RANGE' &&
                          typeof s.minReps === 'number' &&
                          typeof s.maxReps === 'number'
                            ? { minReps: s.minReps, maxReps: s.maxReps }
                            : {}),
                        };
                      }),
                    },
                  })),
                },
              })),
            },
          }),
        },
        select: {
          id: true,
          userId: true,
          name: true,
          description: true,
          isPeriodized: true,
          isFavorite: true,
          isCompleted: true,
          programWithDeloads: true,
          programDurationWeeks: true,
          programStartWeek: true,
          programStartDate: true,
          programEndDate: true,
          programTrainingDaysOfWeek: true,
          programTimezone: true,
          programStyle: true,
          createdAt: true,
          updatedAt: true,
          days: {
            select: {
              id: true,
              dayOfWeek: true,
              order: true,
              exercises: {
                select: {
                  id: true,
                  order: true,
                  restSeconds: true,
                  progressionScheme: true,
                  minWeightIncrement: true,
                  exercise: { select: { id: true, name: true } },
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
            orderBy: { order: 'asc' },
          },
        },
      });

      return updated;
    });
  }

  async setFavorite(userId: string, id: string, isFavorite: boolean) {
    // Ensure routine belongs to user
    const routine = await this.db.routine.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!routine) {
      throw new NotFoundException(
        'Routine not found or you do not have permission to modify it.',
      );
    }

    return this.db.routine.update({
      where: { id },
      data: { isFavorite },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        isPeriodized: true,
        isFavorite: true,
        isCompleted: true,
        programStyle: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async setCompleted(userId: string, id: string, isCompleted: boolean) {
    // Ensure routine belongs to user
    const routine = await this.db.routine.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!routine) {
      throw new NotFoundException(
        'Routine not found or you do not have permission to modify it.',
      );
    }

    return this.db.routine.update({
      where: { id },
      data: { isCompleted },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        isPeriodized: true,
        isFavorite: true,
        isCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findCompleted(userId: string) {
    return this.db.routine.findMany({
      where: { userId, isCompleted: true },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        isPeriodized: true,
        isFavorite: true,
        isCompleted: true,
        programStyle: true,
        createdAt: true,
        updatedAt: true,
        days: {
          select: {
            id: true,
            dayOfWeek: true,
            order: true,
            exercises: {
              select: {
                id: true,
                order: true,
                restSeconds: true,
                progressionScheme: true,
                minWeightIncrement: true,
                exercise: { select: { id: true, name: true } },
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
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findFavorites(userId: string) {
    return this.db.routine.findMany({
      where: { userId, isFavorite: true },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        isPeriodized: true,
        isFavorite: true,
        isCompleted: true,
        programWithDeloads: true,
        programDurationWeeks: true,
        programStartWeek: true,
        programStartDate: true,
        programEndDate: true,
        programTimezone: true,
        programStyle: true,
        createdAt: true,
        updatedAt: true,
        days: {
          select: {
            id: true,
            dayOfWeek: true,
            order: true,
            exercises: {
              select: {
                id: true,
                order: true,
                restSeconds: true,
                progressionScheme: true,
                minWeightIncrement: true,
                exercise: { select: { id: true, name: true } },
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
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(userId: string, id: string) {
    // First, verify the routine exists and belongs to the user
    const routine = await this.db.routine.findFirst({
      where: { id, userId },
    });

    if (!routine) {
      throw new NotFoundException(
        'Routine not found or you do not have permission to delete it.',
      );
    }

    // If found, proceed with deletion
    return this.db.routine.delete({
      where: { id },
    });
  }

  /**
   * Create a new TM adjustment event
   *
   * @param userId - User ID from authenticated request
   * @param routineId - Routine ID to associate the adjustment with
   * @param dto - TM adjustment data
   */
  async createTmAdjustment(
    userId: string,
    routineId: string,
    dto: CreateTmEventDto,
  ): Promise<TmEventResponseDto> {
    // Verify routine ownership and that it uses RTF progression schemes
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

    // Verify exercise exists in routine and uses RTF progression schemes
    const hasExercise = routine.days.some((day) =>
      day.exercises.some((ex) => ex.id),
    );

    if (!hasExercise) {
      this.metrics.tmUnknownExerciseRejections++;
      throw new BadRequestException(
        'Exercise not found in routine or does not use RTF progression schemes',
      );
    }

    // Validate delta calculation (optional integrity check)
    const calculatedPost = dto.preTmKg + dto.deltaKg;
    const epsilon = 0.01; // Allow small floating point differences
    if (Math.abs(calculatedPost - dto.postTmKg) > epsilon) {
      this.metrics.tmGuardrailRejections++;
      throw new BadRequestException('preTmKg + deltaKg must equal postTmKg');
    }

    // Guardrails (RTF-B08): reasonable delta bounds and reason length
    const maxAbsPercent = 0.2; // 20% per single adjustment safety cap
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
      // Hard absolute cap
      this.metrics.tmGuardrailRejections++;
      throw new BadRequestException(
        'deltaKg absolute change too large (guardrail)',
      );
    }
    if (dto.reason && dto.reason.length > 240) {
      this.metrics.tmGuardrailRejections++;
      throw new BadRequestException('reason too long (max 240 chars)');
    }

    // Create the adjustment
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

    // Invalidate cached RtF week goals for this routine (all weeks) (RTF-B04 Phase 1.5)
    try {
      // Broad invalidation (all weeks for routine)
      await this.rtfCache.invalidateRoutine(routineId);
      // Targeted safety: also remove specific week key if routine cache implementation
      const directKey = `weekGoals:${routineId}:${dto.weekNumber}`;
      await this.rtfCache.delete(directKey);
    } catch (e) {
      console.warn('RtF cache invalidation failed', {
        routineId,
        error: e?.message,
      });
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

  /**
   * Get TM adjustment events for a routine
   *
   * @param userId - User ID from authenticated request
   * @param routineId - Routine ID to get adjustments for
   * @param exerciseId - Optional filter by exercise
   * @param minWeek - Optional minimum week filter
   * @param maxWeek - Optional maximum week filter
   */
  async getTmAdjustments(
    userId: string,
    routineId: string,
    exerciseId?: string,
    minWeek?: number,
    maxWeek?: number,
  ): Promise<TmEventResponseDto[]> {
    // Verify routine ownership
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: { id: true },
    });

    if (!routine) {
      throw new NotFoundException('Routine not found or not accessible');
    }

    const adjustments = await this.db.tmAdjustment.findMany({
      where: {
        routineId,
        ...(exerciseId && { exerciseId }),
        ...(minWeek && { weekNumber: { gte: minWeek } }),
        ...(maxWeek && { weekNumber: { lte: maxWeek } }),
      },
      orderBy: [{ weekNumber: 'desc' }, { createdAt: 'desc' }],
    });

    const exerciseIds = Array.from(
      new Set(adjustments.map((a) => a.exerciseId)),
    );
    const exercises = await this.db.exercise.findMany({
      where: { id: { in: exerciseIds } },
      select: { id: true, name: true },
    });
    const exerciseNameById = new Map(exercises.map((e) => [e.id, e.name]));

    return adjustments.map((adj) => ({
      id: adj.id,
      routineId,
      exerciseId: adj.exerciseId,
      exerciseName: exerciseNameById.get(adj.exerciseId) ?? 'Unknown Exercise',
      weekNumber: adj.weekNumber,
      deltaKg: adj.deltaKg,
      preTmKg: adj.preTmKg,
      postTmKg: adj.postTmKg,
      reason: adj.reason ?? undefined,
      style: adj.style as 'STANDARD' | 'HYPERTROPHY' | null,
      createdAt: adj.createdAt.toISOString(),
    }));
  }

  /**
   * Get TM adjustment summary statistics per exercise
   *
   * @param userId - User ID from authenticated request
   * @param routineId - Routine ID to get summary for
   */
  async getTmAdjustmentSummary(
    userId: string,
    routineId: string,
  ): Promise<TmEventSummaryDto[]> {
    // Verify routine ownership
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: { id: true },
    });

    if (!routine) {
      throw new NotFoundException('Routine not found or not accessible');
    }

    // Get aggregated statistics using groupBy
    const summary = await this.db.tmAdjustment.groupBy({
      by: ['exerciseId'],
      where: { routineId },
      _count: { id: true },
      _sum: { deltaKg: true },
      _avg: { deltaKg: true },
      _max: { createdAt: true },
    });

    // Get exercise names
    const exerciseIds = summary.map((s) => s.exerciseId);
    const exercises = await this.db.exercise.findMany({
      where: { id: { in: exerciseIds } },
      select: { id: true, name: true },
    });

    const exerciseMap = new Map(exercises.map((e) => [e.id, e.name]));

    return summary.map((s) => ({
      exerciseId: s.exerciseId,
      exerciseName: exerciseMap.get(s.exerciseId) || 'Unknown Exercise',
      adjustmentCount: s._count.id,
      totalDeltaKg: s._sum.deltaKg || 0,
      averageDeltaKg: s._avg.deltaKg || 0,
      lastAdjustmentDate: s._max.createdAt?.toISOString() || null,
    }));
  }
}
