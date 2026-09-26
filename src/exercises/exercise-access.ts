import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, 'exercise'>;

/**
 * EXER-06: the exercises a member may put in a routine, swap in, star or aim
 * at -- the shared catalog and their own custom exercises. Another member's
 * custom exercise is treated as one that does not exist.
 */
export const usableExerciseWhere = (
  userId: string,
): Prisma.ExerciseWhereInput => ({
  OR: [{ ownerId: null }, { ownerId: userId }],
});

/** The given ids this member may not use, in the order given, each once. */
export async function unusableExerciseIds(
  db: Db,
  userId: string,
  ids: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const usable = await db.exercise.findMany({
    where: { id: { in: unique }, ...usableExerciseWhere(userId) },
    select: { id: true },
  });
  const found = new Set(usable.map((exercise) => exercise.id));
  return unique.filter((id) => !found.has(id));
}

/** 404 unless every id is a catalog exercise or one of this member's own. */
export async function assertUsableExercises(
  db: Db,
  userId: string,
  ids: readonly string[],
  message = 'Exercise not found',
): Promise<void> {
  if ((await unusableExerciseIds(db, userId, ids)).length > 0) {
    throw new NotFoundException(message);
  }
}
