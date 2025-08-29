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

  async create(userId: string, dto: CreateRoutineDto) {
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
      // Verify ownership
      const existing = await tx.routine.findFirst({
        where: { id, userId },
        select: { id: true },
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

      // Update routine basic fields and recreate nested structure
      const updated = await tx.routine.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          isPeriodized: false,
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

  async setCompleted(userId: string, id: string, isCompleted: boolean) {
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
