import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CLONE_ROUTINE_REFUSALS,
  CUSTOM_EXERCISE_REFUSALS,
  CUSTOM_EXERCISES_MAX,
  exerciseNameKey,
  type CustomExerciseInput,
  type Exercise,
  type RoutineVersionSetup,
  type UpdateCustomExerciseRequest,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import {
  customExerciseData,
  customExerciseRefusal,
  mergeCustomExercise,
} from './custom-exercise-rules';
import {
  customExercisesInUse,
  exerciseSelect,
  mapExercise,
} from './exercises.service';

type Tx = Prisma.TransactionClient;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const nameTaken = () =>
  new ConflictException(
    `${CUSTOM_EXERCISE_REFUSALS.NAME_TAKEN}: you already have an exercise by that name, or the catalog does`,
  );

/**
 * EXER-06: exercises a member creates for themselves. Only the owner is ever
 * served one, may change it, or may use it anywhere an exercise is accepted
 * (`exercise-access.ts`). A used exercise is archived rather than deleted, so
 * its workouts and records keep naming it.
 */
@Injectable()
export class CustomExercisesService {
  constructor(private readonly db: DatabaseService) {}

  async create(userId: string, input: CustomExerciseInput): Promise<Exercise> {
    const refusal = customExerciseRefusal(input);
    if (refusal) throw new BadRequestException(refusal);
    const data = customExerciseData(input);
    try {
      return await this.db.$transaction(async (tx) => {
        const count = await tx.exercise.count({ where: { ownerId: userId } });
        if (count >= CUSTOM_EXERCISES_MAX) {
          throw new ConflictException(
            `${CUSTOM_EXERCISE_REFUSALS.LIMIT_REACHED}: you can keep up to ${CUSTOM_EXERCISES_MAX} custom exercises, archived ones included`,
          );
        }
        await this.assertNameFree(tx, userId, data.name);
        const created = await tx.exercise.create({
          data: { ...data, ownerId: userId },
          select: exerciseSelect,
        });
        return mapExercise(created, false);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  async update(
    userId: string,
    id: string,
    patch: UpdateCustomExerciseRequest,
  ): Promise<Exercise> {
    try {
      return await this.db.$transaction(async (tx) => {
        const stored = await this.owned(tx, userId, id);
        const input = mergeCustomExercise(stored, patch);
        const refusal = customExerciseRefusal(input);
        if (refusal) throw new BadRequestException(refusal);
        const data = customExerciseData(input);
        if (exerciseNameKey(data.name) !== exerciseNameKey(stored.name)) {
          await this.assertNameFree(tx, userId, data.name, id);
        }
        const updated = await tx.exercise.update({
          where: { id },
          data,
          select: exerciseSelect,
        });
        return this.withUse(tx, updated);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
  }

  /** Out of the catalog and pickers; routines, workouts and records keep it. */
  setArchived(userId: string, id: string, archived: boolean): Promise<Exercise> {
    return this.db.$transaction(async (tx) => {
      await this.owned(tx, userId, id);
      const updated = await tx.exercise.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        select: exerciseSelect,
      });
      return this.withUse(tx, updated);
    });
  }

  /** Only an exercise nothing uses; anything else is archived instead. */
  async remove(userId: string, id: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await this.owned(tx, userId, id);
      const inUse = await customExercisesInUse(tx, [id]);
      if (inUse.size > 0) {
        throw new ConflictException(
          `${CUSTOM_EXERCISE_REFUSALS.IN_USE}: a routine or a workout uses this exercise, so it can be archived but not deleted`,
        );
      }
      await tx.exercise.delete({ where: { id } });
    });
  }

  /**
   * ROUT-05 + EXER-06: a routine cloned from another member may name their
   * custom exercises, which the cloner cannot use. Each becomes one of the
   * cloner's own -- theirs of the same name if they have one, else a copy of
   * its muscles, equipment and pattern (never its private note) -- and the
   * setup is returned pointing at those. A catalog exercise of that name wins
   * over a copy.
   */
  async adoptForClone(
    userId: string,
    setup: RoutineVersionSetup,
  ): Promise<RoutineVersionSetup> {
    const ids = [
      ...new Set(
        setup.days.flatMap((day) => day.exercises.map((e) => e.exercise.id)),
      ),
    ];
    const rows = await this.db.exercise.findMany({
      where: { id: { in: ids } },
      select: exerciseSelect,
    });
    if (rows.length !== ids.length) {
      throw new ConflictException(
        `${CLONE_ROUTINE_REFUSALS.UNKNOWN_EXERCISE}: an exercise in this routine is no longer in the catalog`,
      );
    }
    const foreign = rows.filter(
      (row) => row.ownerId !== null && row.ownerId !== userId,
    );
    if (foreign.length === 0) return setup;

    const replacement = await this.db.$transaction(async (tx) => {
      const mine = await tx.exercise.findMany({
        where: { OR: [{ ownerId: null }, { ownerId: userId }] },
        select: { id: true, name: true, ownerId: true },
      });
      const byKey = new Map<string, string>();
      // Catalog last, so it wins a tie with the member's own.
      for (const row of [...mine].sort(
        (a, b) => Number(a.ownerId === null) - Number(b.ownerId === null),
      )) {
        byKey.set(exerciseNameKey(row.name), row.id);
      }
      let owned = mine.filter((row) => row.ownerId === userId).length;
      const map = new Map<string, string>();
      for (const row of foreign) {
        const key = exerciseNameKey(row.name);
        const existing = byKey.get(key);
        if (existing) {
          map.set(row.id, existing);
          continue;
        }
        if (owned >= CUSTOM_EXERCISES_MAX) {
          throw new ConflictException(
            `${CUSTOM_EXERCISE_REFUSALS.LIMIT_REACHED}: this routine needs custom exercises you have no room for (up to ${CUSTOM_EXERCISES_MAX})`,
          );
        }
        const copy = await tx.exercise.create({
          data: {
            ownerId: userId,
            name: row.name,
            primaryMuscles: row.primaryMuscles,
            secondaryMuscles: row.secondaryMuscles,
            equipment: row.equipment,
            equipmentRequired: row.equipmentRequired,
            movementPattern: row.movementPattern,
            mechanic: row.mechanic,
          },
          select: { id: true },
        });
        owned += 1;
        byKey.set(key, copy.id);
        map.set(row.id, copy.id);
      }
      return map;
    });

    return {
      ...setup,
      days: setup.days.map((day) => ({
        ...day,
        exercises: day.exercises.map((exercise) => {
          const id = replacement.get(exercise.exercise.id);
          return id
            ? { ...exercise, exercise: { ...exercise.exercise, id } }
            : exercise;
        }),
      })),
    };
  }

  private async owned(tx: Tx, userId: string, id: string) {
    const stored = await tx.exercise.findFirst({
      where: { id, ownerId: userId },
      select: {
        name: true,
        primaryMuscles: true,
        secondaryMuscles: true,
        equipmentRequired: true,
        movementPattern: true,
        mechanic: true,
        note: true,
      },
    });
    if (!stored) throw new NotFoundException('Exercise not found');
    return stored;
  }

  private async assertNameFree(
    tx: Tx,
    userId: string,
    name: string,
    exceptId?: string,
  ) {
    const clash = await tx.exercise.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        OR: [{ ownerId: null }, { ownerId: userId }],
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw nameTaken();
  }

  private async withUse(
    tx: Tx,
    row: Prisma.ExerciseGetPayload<{ select: typeof exerciseSelect }>,
  ) {
    const inUse = await customExercisesInUse(tx, [row.id]);
    return mapExercise(row, inUse.has(row.id));
  }
}
