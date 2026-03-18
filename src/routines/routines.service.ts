import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { WorkoutsService } from '../workouts/workouts.service';
import { buildRtfProgramSnapshot } from '../workouts/rtf-schedules';
import {
  ROUTINE_COMPLETED_SELECT,
  ROUTINE_COMPLETED_TOGGLE_SELECT,
  ROUTINE_DETAIL_SELECT,
  ROUTINE_FAVORITE_TOGGLE_SELECT,
  ROUTINE_MUTATION_SELECT,
  ROUTINE_UPDATE_SELECT,
  ROUTINE_WITH_PROGRAM_SELECT,
} from './routine.selects';

@Injectable()
export class RoutinesService {
  constructor(
    private readonly db: DatabaseService,
    // Inject workouts service to leverage existing RtF weekly goal logic
    private readonly workoutsService: WorkoutsService,
  ) {}

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
                note: e.note,
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
                      ...(typeof s.rir === 'number' ? { rir: s.rir } : {}),
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
      select: ROUTINE_MUTATION_SELECT,
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
      select: ROUTINE_WITH_PROGRAM_SELECT,
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
      select: ROUTINE_DETAIL_SELECT,
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
                    note: e.note,
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
                          ...(typeof s.rir === 'number' ? { rir: s.rir } : {}),
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
        select: ROUTINE_UPDATE_SELECT,
      });

      return updated;
    });
  }

  async updateExerciseNote(
    userId: string,
    routineId: string,
    routineExerciseId: string,
    note: string,
  ) {
    // Verify ownership
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
    });
    if (!routine) {
      throw new NotFoundException('Routine not found');
    }

    // Verify routineExercise belongs to routine
    const re = await this.db.routineExercise.findFirst({
      where: {
        id: routineExerciseId,
        routineDay: { routineId },
      },
    });

    if (!re) {
      throw new NotFoundException('Exercise not found in this routine');
    }

    return this.db.routineExercise.update({
      where: { id: routineExerciseId },
      data: { note },
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
      select: ROUTINE_FAVORITE_TOGGLE_SELECT,
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
      select: ROUTINE_COMPLETED_TOGGLE_SELECT,
    });
  }

  async findCompleted(userId: string) {
    return this.db.routine.findMany({
      where: { userId, isCompleted: true },
      select: ROUTINE_COMPLETED_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findFavorites(userId: string) {
    return this.db.routine.findMany({
      where: { userId, isFavorite: true },
      select: ROUTINE_WITH_PROGRAM_SELECT,
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

}
