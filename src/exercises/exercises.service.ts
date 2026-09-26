import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EXERCISE_EQUIPMENT,
  Exercise,
  ExerciseEquipment,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { usableExerciseWhere } from './exercise-access';

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
  ownerId: true,
  note: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ExerciseRecord = Prisma.ExerciseGetPayload<{
  select: typeof exerciseSelect;
}>;

const EQUIPMENT_SET = new Set<string>(EXERCISE_EQUIPMENT);

/**
 * Serialization boundary: Prisma row -> `Exercise` contract. Equipment is a
 * text array in the database, so values outside the closed vocabulary are
 * dropped here rather than leaking an untyped string to clients. The owner id
 * never leaves the server: a custom exercise is only ever served to its owner,
 * so `isCustom` says all a client needs.
 */
export function mapExercise(
  exercise: ExerciseRecord,
  inUse?: boolean,
): Exercise {
  const { ownerId, note, archivedAt, ...rest } = exercise;
  const base: Exercise = {
    ...rest,
    equipmentRequired: exercise.equipmentRequired.filter(
      (item): item is ExerciseEquipment => EQUIPMENT_SET.has(item),
    ),
    createdAt: exercise.createdAt.toISOString(),
    updatedAt: exercise.updatedAt.toISOString(),
  };
  if (ownerId === null) return base;
  return {
    ...base,
    isCustom: true,
    note,
    archivedAt: archivedAt?.toISOString() ?? null,
    inUse: inUse ?? false,
  };
}

/** Custom exercise ids that a routine (any copy) or a logged set uses. */
export async function customExercisesInUse(
  db: Pick<Prisma.TransactionClient, 'routineExercise' | 'setLog'>,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [inRoutines, inLogs] = await Promise.all([
    db.routineExercise.groupBy({
      by: ['exerciseId'],
      where: { exerciseId: { in: [...ids] } },
    }),
    db.setLog.groupBy({
      by: ['exerciseId'],
      where: { exerciseId: { in: [...ids] } },
    }),
  ]);
  return new Set(
    [...inRoutines, ...inLogs].map((row) => row.exerciseId),
  );
}

@Injectable()
export class ExercisesService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * The catalog plus the caller's own custom exercises (EXER-06), archived
   * ones included so history can still name them; pickers hide those.
   */
  async findAll(userId: string): Promise<Exercise[]> {
    // Fetch then sort with a deterministic, locale-aware comparator to avoid
    // environment-dependent DB collation differences (CI vs local).
    const exercises = await this.db.exercise.findMany({
      where: usableExerciseWhere(userId),
      select: exerciseSelect,
    });
    const inUse = await customExercisesInUse(
      this.db,
      exercises.filter((e) => e.ownerId !== null).map((e) => e.id),
    );
    const collator = new Intl.Collator('en', {
      sensitivity: 'base',
      ignorePunctuation: true,
    });
    return exercises
      .sort((a, b) => collator.compare(a.name, b.name))
      .map((exercise) => mapExercise(exercise, inUse.has(exercise.id)));
  }
}
