import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateRoutineDto, RepTypeDto } from './dto/create-routine.dto';

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

      // Parse date-only string as UTC midnight; PostgreSQL @db.Date stores date only
      const start = new Date(`${dto.programStartDate}T00:00:00.000Z`);
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
            }
          : {
              programWithDeloads: null,
              programDurationWeeks: null,
              programStartWeek: null,
              programStartDate: null,
              programEndDate: null,
              programTrainingDaysOfWeek: [],
              programTimezone: null,
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
                },
              },
            },
          },
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
                },
              },
            },
          },
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
                },
              },
            },
          },
        },
      },
    });

    if (!routine) {
      throw new NotFoundException('Routine not found');
    }

    return routine;
  }

  async update(userId: string, id: string, dto: CreateRoutineDto) {
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
      await tx.routineDay.deleteMany({ where: { routineId: id } });

      // Determine if any exercise uses PROGRAMMED_RTF
      const hasRtF = dto.days.some((d) =>
        d.exercises.some((e) => e.progressionScheme === 'PROGRAMMED_RTF'),
      );

      let programWithDeloads: boolean | null = null;
      let programDurationWeeks: number | null = null;
      let programStartDate: Date | null = null;
      let programEndDate: Date | null = null;
      let programTimezone: string | null = null;
      let programTrainingDaysOfWeek: number[] = [];

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
        const start = new Date(`${dto.programStartDate}T00:00:00.000Z`);
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
        // Preserve end date if start week is create-only and base fields unchanged
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
          // Keep existing computed end date
          programEndDate = existing.programEndDate;
        } else {
          // Recompute full window
          const totalDays = programDurationWeeks * 7 - 1;
          programEndDate = this.addDays(start, totalDays);
        }
      }

      // Update routine basic fields and recreate nested structure
      const updated = await tx.routine.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          isPeriodized: false,
          ...(hasRtF
            ? {
                programWithDeloads,
                programDurationWeeks,
                programStartDate,
                programEndDate,
                programTrainingDaysOfWeek,
                programTimezone,
              }
            : {
                programWithDeloads: null,
                programDurationWeeks: null,
                programStartDate: null,
                programEndDate: null,
                programTrainingDaysOfWeek: [],
                programTimezone: null,
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
                  },
                },
              },
            },
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
                },
              },
            },
          },
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
                },
              },
            },
          },
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
}
