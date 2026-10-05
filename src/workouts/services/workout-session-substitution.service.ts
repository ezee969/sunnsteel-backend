import { apiError } from "@sunsteel/contracts";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WorkoutSessionStatus } from "@prisma/client";
import type {
  SessionExerciseSubstitution,
  SubstituteSessionExerciseResponse,
} from "@sunsteel/contracts";
import { DatabaseService } from "../../database/database.service";
import { lockTrainingAccount } from "../analytics/analytics-lock";
import { ensureSessionSnapshot } from "../analytics/session-snapshot";
import { SubstituteSessionExerciseDto } from "../dto/substitute-session-exercise.dto";
import {
  readSubstitutions,
  withoutSubstitution,
  withSubstitution,
} from "../session-substitutions";
import { toWorkoutSessionResponse } from "../workout-session.mapper";
import { buildWorkoutSessionSelect } from "../workout-session.selects";
import { usableExerciseWhere } from "../../exercises/exercise-access";

const slotLogs = (sessionId: string, routineExerciseId: string) => ({
  sessionId,
  OR: [
    { sourceRoutineExerciseId: routineExerciseId },
    { sourceRoutineExerciseId: null, routineExerciseId },
  ],
});

/**
 * LIVE-11: swap the exercise performed for one slot of an active session.
 *
 * The snapshot keeps the prescription; the swap lives in
 * `WorkoutSession.exerciseSubstitutions`. A swap is refused once the slot has
 * a completed set, because that work was done with the other exercise. The
 * slot's incomplete drafts are removed with it: their reps and load were
 * typed for the exercise being replaced.
 */
@Injectable()
export class WorkoutSessionSubstitutionService {
  constructor(private readonly db: DatabaseService) {}

  substitute(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
    dto: SubstituteSessionExerciseDto,
  ): Promise<SubstituteSessionExerciseResponse> {
    return this.db.$transaction(async (tx) => {
      const { slot, substitutions } = await this.loadSlot(
        tx,
        userId,
        sessionId,
        routineExerciseId,
      );

      // ROUT-17: an 8-week block belongs to its exercise -- its reference max
      // means nothing for another one -- so the swap is for today only. A
      // slot with no reference yet (a clone) has no block to lose.
      if (dto.applyToRoutine) {
        const linear = await tx.routineExercise.count({
          where: {
            id: routineExerciseId,
            progressionScheme: "LINEAR_PERIODIZATION",
            NOT: { linearPeriodization: { equals: Prisma.DbNull } },
          },
        });
        if (linear)
          throw new BadRequestException(apiError("LINEAR_BLOCK_SWAP_ROUTINE"));
      }

      let next = withoutSubstitution(substitutions, routineExerciseId);
      if (dto.exerciseId !== slot.exercise.id) {
        const exercise = await tx.exercise.findFirst({
          where: { id: dto.exerciseId, ...usableExerciseWhere(userId) },
          select: {
            id: true,
            name: true,
            primaryMuscles: true,
            secondaryMuscles: true,
          },
        });
        if (!exercise)
          throw new NotFoundException(apiError("EXERCISE_NOT_FOUND"));
        next = withSubstitution(substitutions, {
          routineExerciseId,
          exercise,
          substitutedAt: new Date().toISOString(),
        });
      }

      await this.save(tx, sessionId, routineExerciseId, next);

      let routineUpdated = false;
      if (dto.applyToRoutine) {
        const updated = await tx.routineExercise.updateMany({
          where: { id: routineExerciseId, routineDay: { routine: { userId } } },
          data: { exerciseId: dto.exerciseId },
        });
        routineUpdated = updated.count === 1;
      }

      return { session: await this.read(tx, sessionId), routineUpdated };
    });
  }

  revert(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
  ): Promise<SubstituteSessionExerciseResponse> {
    return this.db.$transaction(async (tx) => {
      const { substitutions } = await this.loadSlot(
        tx,
        userId,
        sessionId,
        routineExerciseId,
      );
      await this.save(
        tx,
        sessionId,
        routineExerciseId,
        withoutSubstitution(substitutions, routineExerciseId),
      );
      return { session: await this.read(tx, sessionId), routineUpdated: false };
    });
  }

  private async loadSlot(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
    routineExerciseId: string,
  ) {
    await lockTrainingAccount(tx, userId);
    const session = await tx.workoutSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, status: true, exerciseSubstitutions: true },
    });
    if (!session)
      throw new NotFoundException(apiError("WORKOUT_SESSION_NOT_FOUND"));
    if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new BadRequestException(apiError("SWAP_SESSION_NOT_ACTIVE"));
    }

    const snapshot = await ensureSessionSnapshot(tx, sessionId);
    const slot = snapshot.routineDay.exercises.find(
      (exercise) => exercise.id === routineExerciseId,
    );
    if (!slot) {
      throw new NotFoundException(apiError("SESSION_EXERCISE_NOT_FOUND"));
    }

    const completed = await tx.setLog.count({
      where: { ...slotLogs(sessionId, routineExerciseId), isCompleted: true },
    });
    if (completed > 0) {
      throw new ConflictException(apiError("SWAP_SETS_COMPLETED"));
    }

    return {
      slot,
      substitutions: readSubstitutions(session.exerciseSubstitutions),
    };
  }

  private async save(
    tx: Prisma.TransactionClient,
    sessionId: string,
    routineExerciseId: string,
    substitutions: SessionExerciseSubstitution[],
  ) {
    await tx.setLog.deleteMany({
      where: { ...slotLogs(sessionId, routineExerciseId), isCompleted: false },
    });
    await tx.workoutSession.update({
      where: { id: sessionId },
      data: {
        exerciseSubstitutions:
          substitutions as unknown as Prisma.InputJsonValue,
        lastActivityAt: new Date(),
      },
    });
  }

  private async read(tx: Prisma.TransactionClient, sessionId: string) {
    const session = await tx.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: buildWorkoutSessionSelect(true),
    });
    return toWorkoutSessionResponse(session);
  }
}
