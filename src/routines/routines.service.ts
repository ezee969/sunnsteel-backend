import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProgressionScheme } from '@prisma/client';
import { Routine } from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { UpdateRoutineDto } from './dto/update-routine.dto';
import {
  ROUTINE_TOGGLE_SELECT,
  ROUTINE_WITH_DAYS_SELECT,
} from './routine.selects';
import { toRoutineResponse } from './routine.mapper';

type RoutineSetInput = {
  setNumber: number;
  repType: 'RANGE' | 'FIXED';
  reps?: number | null;
  minReps?: number | null;
  maxReps?: number | null;
  weight?: number | null;
  rir?: number | null;
};

type RoutineExerciseInput = {
  exerciseId: string;
  order?: number;
  restSeconds: number;
  note?: string;
  progressionScheme: ProgressionScheme;
  minWeightIncrement?: number;
  sets: RoutineSetInput[];
};

type RoutineDayInput = {
  dayOfWeek: number;
  order?: number;
  exercises: RoutineExerciseInput[];
};

@Injectable()
export class RoutinesService {
  constructor(private readonly db: DatabaseService) {}

  private mapRoutineSetForCreate(set: RoutineSetInput) {
    if (set.repType === 'RANGE') {
      if (typeof set.minReps !== 'number' || typeof set.maxReps !== 'number') {
        throw new BadRequestException(
          'For RANGE repType, minReps and maxReps are required',
        );
      }
      if (set.minReps > set.maxReps) {
        throw new BadRequestException(
          'minReps must be less than or equal to maxReps',
        );
      }
    } else if (set.repType === 'FIXED') {
      if (typeof set.reps !== 'number') {
        throw new BadRequestException('For FIXED repType, reps is required');
      }
    }

    const repTypeVal: 'RANGE' | 'FIXED' =
      set.repType === 'RANGE' ? 'RANGE' : 'FIXED';

    return {
      setNumber: set.setNumber,
      repType: repTypeVal,
      weight: set.weight,
      ...(typeof set.rir === 'number' ? { rir: set.rir } : {}),
      ...(repTypeVal === 'FIXED' && typeof set.reps === 'number'
        ? { reps: set.reps }
        : {}),
      ...(repTypeVal === 'RANGE' &&
      typeof set.minReps === 'number' &&
      typeof set.maxReps === 'number'
        ? { minReps: set.minReps, maxReps: set.maxReps }
        : {}),
    };
  }

  private mapRoutineExerciseForCreate(exercise: RoutineExerciseInput) {
    return {
      exercise: { connect: { id: exercise.exerciseId } },
      order: exercise.order ?? 0,
      restSeconds: exercise.restSeconds,
      note: exercise.note,
      progressionScheme: exercise.progressionScheme ?? 'NONE',
      minWeightIncrement: exercise.minWeightIncrement ?? 2.5,
      sets: {
        create: exercise.sets.map((set) => this.mapRoutineSetForCreate(set)),
      },
    };
  }

  private mapRoutineDayForCreate(day: RoutineDayInput) {
    return {
      dayOfWeek: day.dayOfWeek,
      order: day.order ?? 0,
      exercises: {
        create: day.exercises.map((exercise) =>
          this.mapRoutineExerciseForCreate(exercise),
        ),
      },
    };
  }

  async create(userId: string, dto: CreateRoutineDto): Promise<Routine> {
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
          create: dto.days.map((day) => this.mapRoutineDayForCreate(day)),
        },
      },
      select: ROUTINE_WITH_DAYS_SELECT,
    });
    return toRoutineResponse(routine);
  }

  async findAll(
    userId: string,
    filter?: { isFavorite?: boolean; isCompleted?: boolean },
  ): Promise<Routine[]> {
    const where: Prisma.RoutineWhereInput = { userId };
    if (typeof filter?.isFavorite === 'boolean') {
      where.isFavorite = filter.isFavorite;
    }
    if (typeof filter?.isCompleted === 'boolean') {
      where.isCompleted = filter.isCompleted;
    }

    const routines = await this.db.routine.findMany({
      where,
      select: ROUTINE_WITH_DAYS_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return routines.map(toRoutineResponse);
  }

  async findOne(userId: string, id: string): Promise<Routine> {
    const routine = await this.db.routine.findFirst({
      where: { id, userId },
      select: ROUTINE_WITH_DAYS_SELECT,
    });

    if (!routine) {
      throw new NotFoundException('Routine not found');
    }

    return toRoutineResponse(routine);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateRoutineDto,
  ): Promise<Routine> {
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
      // Only delete and recreate days if days array is provided in the update
      if (dto.days) {
        await tx.routineDay.deleteMany({ where: { routineId: id } });
      }

      const updated = await tx.routine.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          isPeriodized: false,
          ...(dto.days && {
            days: {
              create: dto.days.map((day) => this.mapRoutineDayForCreate(day)),
            },
          }),
        },
        select: ROUTINE_WITH_DAYS_SELECT,
      });

      return toRoutineResponse(updated);
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
      select: ROUTINE_TOGGLE_SELECT,
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
      select: ROUTINE_TOGGLE_SELECT,
    });
  }

  async findCompleted(userId: string): Promise<Routine[]> {
    const routines = await this.db.routine.findMany({
      where: { userId, isCompleted: true },
      select: ROUTINE_WITH_DAYS_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return routines.map(toRoutineResponse);
  }

  async findFavorites(userId: string): Promise<Routine[]> {
    const routines = await this.db.routine.findMany({
      where: { userId, isFavorite: true },
      select: ROUTINE_WITH_DAYS_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return routines.map(toRoutineResponse);
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
