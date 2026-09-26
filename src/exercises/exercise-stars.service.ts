import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  STARRED_EXERCISES_MAX,
  StarredExercisesResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { usableExerciseWhere } from './exercise-access';

type StarReader = Pick<Prisma.TransactionClient, 'starredExercise'>;

const starSelect = { exerciseId: true, createdAt: true } as const;

async function readStars(
  db: StarReader,
  userId: string,
): Promise<StarredExercisesResponse> {
  const rows = await db.starredExercise.findMany({
    where: { userId },
    select: starSelect,
    orderBy: [{ createdAt: 'desc' }, { exerciseId: 'asc' }],
    take: STARRED_EXERCISES_MAX,
  });
  return {
    items: rows.map((row) => ({
      exerciseId: row.exerciseId,
      starredAt: row.createdAt.toISOString(),
    })),
  };
}

/**
 * EXER-07: private, per-account stars on catalog exercises. They only order
 * the owner's pickers and filter the catalog; they are never shown to other
 * members and are unrelated to the public training-identity favorites.
 * Starring and unstarring are idempotent and return the whole list.
 */
@Injectable()
export class ExerciseStarsService {
  constructor(private readonly db: DatabaseService) {}

  list(userId: string): Promise<StarredExercisesResponse> {
    return readStars(this.db, userId);
  }

  star(userId: string, exerciseId: string): Promise<StarredExercisesResponse> {
    return this.db.$transaction(async (tx) => {
      const exercise = await tx.exercise.findFirst({
        where: { id: exerciseId, ...usableExerciseWhere(userId) },
        select: { id: true },
      });
      if (!exercise) throw new NotFoundException('Exercise not found');

      const existing = await tx.starredExercise.findUnique({
        where: { userId_exerciseId: { userId, exerciseId } },
        select: { exerciseId: true },
      });
      if (!existing) {
        const count = await tx.starredExercise.count({ where: { userId } });
        if (count >= STARRED_EXERCISES_MAX) {
          throw new ConflictException(
            `You can star at most ${STARRED_EXERCISES_MAX} exercises`,
          );
        }
        try {
          await tx.starredExercise.create({ data: { userId, exerciseId } });
        } catch (error) {
          // A concurrent request starred it first: the outcome is the same.
          if (
            !(
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            )
          ) {
            throw error;
          }
        }
      }
      return readStars(tx, userId);
    });
  }

  async unstar(
    userId: string,
    exerciseId: string,
  ): Promise<StarredExercisesResponse> {
    await this.db.starredExercise.deleteMany({
      where: { userId, exerciseId },
    });
    return readStars(this.db, userId);
  }
}
