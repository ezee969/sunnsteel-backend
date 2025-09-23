import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateRoutineDto, RepTypeDto } from './dto/create-routine.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import { CreateTmEventDto, TmEventResponseDto, TmEventSummaryDto } from './dto/tm-adjustment.dto';

@Injectable()
export class RoutinesService {
  constructor(private readonly db: DatabaseService) {}

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
          'programWithDeloads is required when using PROGRAMMED_RTF',
        );
      }
      if (!dto.programStartDate) {
        throw new BadRequestException(
          'programStartDate (yyyy-mm-dd) is required when using PROGRAMMED_RTF',
        );
      }
      if (!dto.programTimezone) {
        throw new BadRequestException(
          'programTimezone (IANA) is required when using PROGRAMMED_RTF',
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
          'Routine requires at least one training day when using PROGRAMMED_RTF',
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
          throw new BadRequestException('programStyle must be STANDARD or HYPERTROPHY');
        }
        programStyle = dto.programStyle as 'STANDARD' | 'HYPERTROPHY';
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
                    }
                  : {}),
                sets: {
                  create: e.sets.map((s) => {
                    if (s.repType === RepTypeDto.RANGE) {
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
                    } else if (s.repType === RepTypeDto.FIXED) {
                      if (typeof s.reps !== 'number') {
                        throw new BadRequestException(
                          'For FIXED repType, reps is required',
                        );
                      }
                    }

                    const repTypeVal: 'RANGE' | 'FIXED' =
                      s.repType === RepTypeDto.RANGE ? 'RANGE' : 'FIXED';
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

  async findOne(userId: string, id: string) {
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

      // Determine if any exercise uses PROGRAMMED_RTF (only if days are being updated)
      const hasRtF = dto.days ? dto.days.some((d) =>
        d.exercises.some((e) => e.progressionScheme === 'PROGRAMMED_RTF'),
      ) : false;

      let programWithDeloads: boolean | null = null;
      let programDurationWeeks: number | null = null;
      let programStartDate: Date | null = null;
      let programEndDate: Date | null = null;
      let programTimezone: string | null = null;
      let programTrainingDaysOfWeek: number[] = [];
      let programStyle: 'STANDARD' | 'HYPERTROPHY' | null = null;

      if (hasRtF && dto.days) {
        if (typeof dto.programWithDeloads !== 'boolean') {
          throw new BadRequestException(
            'programWithDeloads is required when using PROGRAMMED_RTF',
          );
        }
        if (!dto.programStartDate) {
          throw new BadRequestException(
            'programStartDate (yyyy-mm-dd) is required when using PROGRAMMED_RTF',
          );
        }
        if (!dto.programTimezone) {
          throw new BadRequestException(
            'programTimezone (IANA) is required when using PROGRAMMED_RTF',
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
            'Routine requires at least one training day when using PROGRAMMED_RTF',
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
          programStyle = dto.programStyle as 'STANDARD' | 'HYPERTROPHY';
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
          const remainingWeeks = programDurationWeeks - (clamped - 1);
          const totalDays = remainingWeeks * 7 - 1;
          programEndDate = this.addDays(start, totalDays);
        } else if (baseUnchanged && existing.programEndDate) {
          programEndDate = existing.programEndDate;
        } else {
          const totalDays = programDurationWeeks * 7 - 1;
            programEndDate = this.addDays(start, totalDays);
        }
      }

      const updated = await tx.routine.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.programStyle !== undefined && {
            programStyle: dto.programStyle
          }),
          isPeriodized: false,
          ...(hasRtF && dto.days
            ? {
                programWithDeloads,
                programDurationWeeks,
                programStartDate,
                programEndDate,
                programTrainingDaysOfWeek,
                programTimezone,
              }
            : dto.days && {
                programWithDeloads: null,
                programDurationWeeks: null,
                programStartDate: null,
                programEndDate: null,
                programTrainingDaysOfWeek: [],
                programTimezone: null,
                programStyle: null,
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
                        }
                      : {}),
                    sets: {
                      create: e.sets.map((s) => {
                        if (s.repType === RepTypeDto.RANGE) {
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
                        } else if (s.repType === RepTypeDto.FIXED) {
                          if (typeof s.reps !== 'number') {
                            throw new BadRequestException(
                              'For FIXED repType, reps is required',
                            );
                          }
                        }

                        const repTypeVal: 'RANGE' | 'FIXED' =
                          s.repType === RepTypeDto.RANGE ? 'RANGE' : 'FIXED';
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
    dto: CreateTmEventDto
  ): Promise<TmEventResponseDto> {
    // Verify routine ownership and that it uses PROGRAMMED_RTF
    const routine = await this.db.routine.findFirst({
      where: { 
        id: routineId, 
        userId,
        days: {
          some: {
            exercises: {
              some: {
                progressionScheme: 'PROGRAMMED_RTF'
              }
            }
          }
        }
      },
      select: { 
        id: true, 
        programStyle: true,
        days: {
          select: {
            exercises: {
              where: {
                exerciseId: dto.exerciseId,
                progressionScheme: 'PROGRAMMED_RTF'
              },
              select: { id: true }
            }
          }
        }
      }
    })

    if (!routine) {
      throw new NotFoundException(
        'Routine not found, not accessible, or does not use PROGRAMMED_RTF'
      )
    }

    // Verify exercise exists in routine and uses PROGRAMMED_RTF
    const hasExercise = routine.days.some(day => 
      day.exercises.some(ex => ex.id)
    )

    if (!hasExercise) {
      throw new BadRequestException(
        'Exercise not found in routine or does not use PROGRAMMED_RTF'
      )
    }

    // Validate delta calculation (optional integrity check)
    const calculatedPost = dto.preTmKg + dto.deltaKg
    const epsilon = 0.01 // Allow small floating point differences
    if (Math.abs(calculatedPost - dto.postTmKg) > epsilon) {
      throw new BadRequestException(
        'preTmKg + deltaKg must equal postTmKg'
      )
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
        style: routine.programStyle
      }
    })

    return {
      id: adjustment.id,
      exerciseId: adjustment.exerciseId,
      weekNumber: adjustment.weekNumber,
      deltaKg: adjustment.deltaKg,
      preTmKg: adjustment.preTmKg,
      postTmKg: adjustment.postTmKg,
      reason: adjustment.reason,
      style: adjustment.style as 'STANDARD' | 'HYPERTROPHY' | null,
      createdAt: adjustment.createdAt
    }
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
    maxWeek?: number
  ): Promise<TmEventResponseDto[]> {
    // Verify routine ownership
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: { id: true }
    })

    if (!routine) {
      throw new NotFoundException('Routine not found or not accessible')
    }

    const adjustments = await this.db.tmAdjustment.findMany({
      where: {
        routineId,
        ...(exerciseId && { exerciseId }),
        ...(minWeek && { weekNumber: { gte: minWeek } }),
        ...(maxWeek && { weekNumber: { lte: maxWeek } })
      },
      orderBy: [
        { weekNumber: 'desc' },
        { createdAt: 'desc' }
      ]
    })

    return adjustments.map(adj => ({
      id: adj.id,
      exerciseId: adj.exerciseId,
      weekNumber: adj.weekNumber,
      deltaKg: adj.deltaKg,
      preTmKg: adj.preTmKg,
      postTmKg: adj.postTmKg,
      reason: adj.reason,
      style: adj.style as 'STANDARD' | 'HYPERTROPHY' | null,
      createdAt: adj.createdAt
    }))
  }

  /**
   * Get TM adjustment summary statistics per exercise
   * 
   * @param userId - User ID from authenticated request
   * @param routineId - Routine ID to get summary for
   */
  async getTmAdjustmentSummary(
    userId: string,
    routineId: string
  ): Promise<TmEventSummaryDto[]> {
    // Verify routine ownership
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: { id: true }
    })

    if (!routine) {
      throw new NotFoundException('Routine not found or not accessible')
    }

    // Get aggregated statistics using groupBy
    const summary = await this.db.tmAdjustment.groupBy({
      by: ['exerciseId'],
      where: { routineId },
      _count: { id: true },
      _sum: { deltaKg: true },
      _avg: { deltaKg: true },
      _max: { createdAt: true }
    })

    // Get exercise names
    const exerciseIds = summary.map(s => s.exerciseId)
    const exercises = await this.db.exercise.findMany({
      where: { id: { in: exerciseIds } },
      select: { id: true, name: true }
    })

    const exerciseMap = new Map(exercises.map(e => [e.id, e.name]))

    return summary.map(s => ({
      exerciseId: s.exerciseId,
      exerciseName: exerciseMap.get(s.exerciseId) || 'Unknown Exercise',
      events: s._count.id,
      netDelta: s._sum.deltaKg || 0,
      avgChange: s._avg.deltaKg || 0,
      lastEventAt: s._max.createdAt
    }))
  }
}
