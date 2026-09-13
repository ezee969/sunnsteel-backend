import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EXERCISE_EQUIPMENT,
  Exercise,
  ExerciseEquipment,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';

export const exerciseSelect = {
  id: true,
  name: true,
  primaryMuscles: true,
  secondaryMuscles: true,
  equipment: true,
  movementPattern: true,
  mechanic: true,
  equipmentRequired: true,
  substitutionGroup: true,
  instructions: true,
  mediaUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ExerciseRecord = Prisma.ExerciseGetPayload<{
  select: typeof exerciseSelect;
}>;

const EQUIPMENT_SET = new Set<string>(EXERCISE_EQUIPMENT);

/**
 * Serialization boundary: Prisma row -> `Exercise` contract. Equipment is a
 * text array in the database, so values outside the closed vocabulary are
 * dropped here rather than leaking an untyped string to clients.
 */
export function mapExercise(exercise: ExerciseRecord): Exercise {
  return {
    ...exercise,
    equipmentRequired: exercise.equipmentRequired.filter(
      (item): item is ExerciseEquipment => EQUIPMENT_SET.has(item),
    ),
    createdAt: exercise.createdAt.toISOString(),
    updatedAt: exercise.updatedAt.toISOString(),
  };
}

@Injectable()
export class ExercisesService {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<Exercise[]> {
    // Fetch then sort with a deterministic, locale-aware comparator to avoid
    // environment-dependent DB collation differences (CI vs local).
    const exercises = await this.db.exercise.findMany({
      select: exerciseSelect,
    });
    const collator = new Intl.Collator('en', {
      sensitivity: 'base',
      ignorePunctuation: true,
    });
    return exercises
      .sort((a, b) => collator.compare(a.name, b.name))
      .map(mapExercise);
  }
}
