import { lockTrainingAccount } from '../analytics/analytics-lock';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkoutSessionStatus } from '@prisma/client';
import { DatabaseService } from '../../database/database.service';
import { UpsertSetLogDto } from '../dto/upsert-set-log.dto';

// Narrow unknown error objects that include a Prisma error code
const isPrismaErrorWithCode = (e: unknown): e is { code: string } => {
  if (typeof e !== 'object' || e === null) return false;
  const maybe = e as { code?: unknown };
  return typeof maybe.code === 'string';
};

@Injectable()
export class WorkoutSessionLogService {
  constructor(private readonly db: DatabaseService) {}

  async upsertSetLog(userId: string, sessionId: string, dto: UpsertSetLogDto) {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      // Validate session ownership and status
      const session = await tx.workoutSession.findFirst({
        where: { id: sessionId, userId },
        select: { id: true, status: true, routineDayId: true },
      });
      if (!session) {
        throw new NotFoundException('Workout session not found');
      }
      if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
        throw new BadRequestException(
          'Cannot modify set logs for a finished session',
        );
      }

      // Validate routineExercise belongs to the session's routineDay
      const routineExercise = await tx.routineExercise.findFirst({
        where: {
          id: dto.routineExerciseId,
          routineDayId: session.routineDayId!,
        },
        select: { id: true, exerciseId: true },
      });
      if (!routineExercise) {
        throw new BadRequestException(
          'Routine exercise does not belong to this session',
        );
      }

      // Validate provided exerciseId matches routineExercise.exerciseId
      if (dto.exerciseId !== routineExercise.exerciseId) {
        throw new BadRequestException(
          'exerciseId does not match routine exercise',
        );
      }

      const completedAt = dto.isCompleted ? new Date() : undefined;

      const where = {
        sessionId_routineExerciseId_setNumber: {
          sessionId,
          routineExerciseId: dto.routineExerciseId,
          setNumber: dto.setNumber,
        },
      } as const;

      const upserted = await tx.setLog.upsert({
        where,
        update: {
          reps: dto.reps,
          weight: dto.weight,
          rpe: dto.rpe,
          isCompleted: dto.isCompleted ?? undefined,
          completedAt: dto.isCompleted === undefined ? undefined : completedAt,
          exerciseId: dto.exerciseId,
        },
        create: {
          sessionId,
          routineExerciseId: dto.routineExerciseId,
          sourceRoutineExerciseId: dto.routineExerciseId,
          exerciseId: dto.exerciseId,
          setNumber: dto.setNumber,
          reps: dto.reps,
          weight: dto.weight,
          rpe: dto.rpe,
          isCompleted: dto.isCompleted ?? false,
          completedAt: dto.isCompleted ? new Date() : undefined,
        },
        select: {
          id: true,
          sessionId: true,
          routineExerciseId: true,
          exerciseId: true,
          setNumber: true,
          reps: true,
          weight: true,
          rpe: true,
          isCompleted: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Commit the heartbeat with the set mutation.
      await tx.workoutSession.update({
        where: { id: sessionId },
        data: { lastActivityAt: new Date() },
      });

      return upserted;
    });
  }

  async deleteSetLog(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
    setNumber: number,
  ) {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      // Validate session ownership and status
      const session = await tx.workoutSession.findFirst({
        where: { id: sessionId, userId },
        select: { id: true, status: true },
      });
      if (!session) {
        throw new NotFoundException('Workout session not found');
      }
      if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
        throw new BadRequestException(
          'Cannot modify set logs for a finished session',
        );
      }

      try {
        const deleted = await tx.setLog.delete({
          where: {
            sessionId_routineExerciseId_setNumber: {
              sessionId,
              routineExerciseId,
              setNumber,
            },
          },
          select: { id: true },
        });
        // Commit the heartbeat with the deletion.
        await tx.workoutSession.update({
          where: { id: sessionId },
          data: { lastActivityAt: new Date() },
        });
        return deleted;
      } catch (err: unknown) {
        // P2025 = Record not found
        if (isPrismaErrorWithCode(err) && err.code === 'P2025') {
          throw new NotFoundException('Set log not found');
        }
        throw err;
      }
    });
  }
}
