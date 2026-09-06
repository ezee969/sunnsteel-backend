import { lockTrainingAccount } from '../analytics/analytics-lock';
import { ensureSessionSnapshot } from '../analytics/session-snapshot';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkoutSessionStatus } from '@prisma/client';
import { DatabaseService } from '../../database/database.service';
import { StartWorkoutDto } from '../dto/start-workout.dto';
import { StartWorkoutResponseDto } from '../dto/start-workout-response.dto';
import { buildWorkoutSessionSelect } from '../workout-session.selects';
import { WorkoutSessionReadService } from '../workout-session-read.service';

// Narrow unknown error objects that include a Prisma error code
const isPrismaErrorWithCode = (e: unknown): e is { code: string } => {
  if (typeof e !== 'object' || e === null) return false;
  const maybe = e as { code?: unknown };
  return typeof maybe.code === 'string';
};

type StartSessionEntity = {
  id: string;
  routineId: string | null;
  sourceRoutineId?: string | null;
  routineDayId: string | null;
  sourceRoutineDayId?: string | null;
  status: WorkoutSessionStatus;
  startedAt: Date;
  endedAt: Date | null;
};

@Injectable()
export class WorkoutSessionStartService {
  constructor(
    private readonly db: DatabaseService,
    private readonly workoutSessionRead: WorkoutSessionReadService,
  ) {}

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

  private toStartWorkoutResponse(
    session: StartSessionEntity,
    reused: boolean,
  ): StartWorkoutResponseDto {
    return {
      id: session.id,
      routineId: session.sourceRoutineId ?? session.routineId!,
      routineDayId: session.sourceRoutineDayId ?? session.routineDayId!,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      reused,
    };
  }

  /**
   * Start a workout session if none active; if one already exists, return it with a reuse flag.
   * Concurrency:
   *  - Partial unique index (status=IN_PROGRESS) in DB guarantees invariant
   *  - We avoid a UX-level 400 by returning the existing session (idempotent semantics)
   *  - On race (P2002) we fetch the winner and return it.
   */
  async startSession(
    userId: string,
    dto: StartWorkoutDto,
  ): Promise<StartWorkoutResponseDto> {
    const preExisting = await this.workoutSessionRead.getActiveSession(userId);
    if (preExisting) {
      return this.toStartWorkoutResponse(preExisting, true);
    }

    let created: StartSessionEntity | null = null;
    try {
      const createdSession = await this.db.$transaction(async (tx) => {
        await lockTrainingAccount(tx, userId);
        // Validate routine and day ownership/relationship
        const routineDay = await tx.routineDay.findFirst({
          where: {
            id: dto.routineDayId,
            routine: { id: dto.routineId, userId },
          },
          select: { id: true, dayOfWeek: true },
        });
        if (!routineDay) {
          throw new NotFoundException(
            'Routine day not found for this user/routine',
          );
        }

        const result = await tx.workoutSession.create({
          data: {
            userId,
            routineId: dto.routineId,
            sourceRoutineId: dto.routineId,
            sourceRoutineDayId: dto.routineDayId,
            routineDayId: dto.routineDayId,
            status: WorkoutSessionStatus.IN_PROGRESS,
            notes: dto.notes,
          },
          select: buildWorkoutSessionSelect(),
        });
        await ensureSessionSnapshot(tx, result.id, 'CAPTURED');
        return result;
      });
      created = createdSession;
      // Initial activity heartbeat (ignore failure)
      try {
        await this.heartbeatSession(created.id);
      } catch {}
    } catch (e: unknown) {
      if (isPrismaErrorWithCode(e) && e.code === 'P2002') {
        const existing = await this.workoutSessionRead.getActiveSession(userId);
        if (existing) {
          return this.toStartWorkoutResponse(existing, true);
        }
        throw new BadRequestException('Active workout session already exists');
      }
      throw e;
    }

    if (!created) {
      throw new BadRequestException('Failed to create workout session');
    }

    return this.toStartWorkoutResponse(created, false);
  }
}
