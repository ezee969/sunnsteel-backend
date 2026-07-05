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

  /**
   * Heartbeat utility to bump lastActivityAt timestamp. Silent on failure
   * so it never blocks the primary mutation path.
   */
  private async heartbeatSession(sessionId: string) {
    try {
      await this.db.workoutSession.update({
        where: { id: sessionId },
        data: { lastActivityAt: new Date() },
        select: { id: true },
      });
    } catch {}
  }

  async upsertSetLog(userId: string, sessionId: string, dto: UpsertSetLogDto) {
    // Validate session ownership and status
    const session = await this.db.workoutSession.findFirst({
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
    const routineExercise = await this.db.routineExercise.findFirst({
      where: { id: dto.routineExerciseId, routineDayId: session.routineDayId },
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

    const upserted = await this.db.setLog.upsert({
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

    // Heartbeat update (non-blocking)
    await this.heartbeatSession(sessionId);

    return upserted;
  }

  async deleteSetLog(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
    setNumber: number,
  ) {
    // Validate session ownership and status
    const session = await this.db.workoutSession.findFirst({
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
      const deleted = await this.db.setLog.delete({
        where: {
          sessionId_routineExerciseId_setNumber: {
            sessionId,
            routineExerciseId,
            setNumber,
          },
        },
        select: { id: true },
      });
      // Heartbeat on delete (non-blocking)
      await this.heartbeatSession(sessionId);
      return deleted;
    } catch (err: unknown) {
      // P2025 = Record not found
      if (isPrismaErrorWithCode(err) && err.code === 'P2025') {
        throw new NotFoundException('Set log not found');
      }
      throw err;
    }
  }
}
