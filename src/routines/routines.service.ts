import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateRoutineDto } from './dto/create-routine.dto';

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
                exerciseId: e.exerciseId,
                order: e.order ?? 0,
                restSeconds: e.restSeconds,
                sets: {
                  create: e.sets.map((s) => ({
                    setNumber: s.setNumber,
                    reps: s.reps,
                    weight: s.weight,
                  })),
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
                  select: { setNumber: true, reps: true, weight: true },
                },
              },
            },
          },
        },
      },
    });
    return routine;
  }

  async findAll(userId: string) {
    const routines = await this.db.routine.findMany({
      where: { userId },
      select: {
        id: true,
        userId: true,
        name: true,
        description: true,
        isPeriodized: true,
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
                  select: { setNumber: true, reps: true, weight: true },
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
                  select: { setNumber: true, reps: true, weight: true },
                },
              },
            },
          },
        },
      },
    });

    return routine;
  }

  async update(userId: string, id: string, dto: CreateRoutineDto) {
    return this.db.$transaction(async (tx) => {
      // Verify ownership
      const existing = await tx.routine.findFirst({ where: { id, userId }, select: { id: true } });
      if (!existing) {
        throw new Error('Routine not found or you do not have permission to edit it.');
      }

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
                  exerciseId: e.exerciseId,
                  order: e.order ?? 0,
                  restSeconds: e.restSeconds,
                  sets: {
                    create: e.sets.map((s) => ({
                      setNumber: s.setNumber,
                      reps: s.reps,
                      weight: s.weight,
                    })),
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
                    select: { setNumber: true, reps: true, weight: true },
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

  async remove(userId: string, id: string) {
    // First, verify the routine exists and belongs to the user
    const routine = await this.db.routine.findFirst({
      where: { id, userId },
    });

    if (!routine) {
      // In a real app, you might want a more specific error type
      throw new Error(
        'Routine not found or you do not have permission to delete it.',
      );
    }

    // If found, proceed with deletion
    return this.db.routine.delete({
      where: { id },
    });
  }
}
