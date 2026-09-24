import { lockTrainingAccount } from '../analytics/analytics-lock';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkoutSessionStatus } from '@prisma/client';
import type { UpsertSetLogResponse } from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { UpsertSetLogDto } from '../dto/upsert-set-log.dto';
import {
  earnedPersonalRecords,
  recordFrontier,
  type RecordSet,
} from '../live-personal-records';
import {
  expectedExerciseId,
  readSubstitutions,
  substitutionFor,
} from '../session-substitutions';
import {
  extraSetRefusal,
  prescribedSetCount,
  prescribedSetKind,
  removeSetRefusal,
} from '../session-extra-sets';
import { toSetLogResponse } from '../workout-session.mapper';

// Narrow unknown error objects that include a Prisma error code
const isPrismaErrorWithCode = (e: unknown): e is { code: string } => {
  if (typeof e !== 'object' || e === null) return false;
  const maybe = e as { code?: unknown };
  return typeof maybe.code === 'string';
};

const highestLoggedSet = async (
  tx: Prisma.TransactionClient,
  sessionId: string,
  routineExerciseId: string,
) =>
  (
    await tx.setLog.findFirst({
      where: { sessionId, routineExerciseId },
      orderBy: { setNumber: 'desc' },
      select: { setNumber: true },
    })
  )?.setNumber ?? 0;

@Injectable()
export class WorkoutSessionLogService {
  constructor(private readonly db: DatabaseService) {}

  async upsertSetLog(
    userId: string,
    sessionId: string,
    dto: UpsertSetLogDto,
  ): Promise<UpsertSetLogResponse> {
    return this.db.$transaction(async (tx) => {
      await lockTrainingAccount(tx, userId);
      // Validate session ownership and status
      const session = await tx.workoutSession.findFirst({
        where: { id: sessionId, userId },
        select: {
          id: true,
          status: true,
          routineDayId: true,
          exerciseSubstitutions: true,
          snapshot: { select: { payload: true } },
        },
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
        select: {
          id: true,
          exerciseId: true,
          exercise: { select: { name: true } },
          sets: { select: { setNumber: true, kind: true } },
        },
      });
      if (!routineExercise) {
        throw new BadRequestException(
          'Routine exercise does not belong to this session',
        );
      }

      // The set must name the slot's exercise, or its LIVE-11 substitute.
      const substitution = substitutionFor(
        readSubstitutions(session.exerciseSubstitutions),
        routineExercise.id,
      );
      if (
        dto.exerciseId !==
        expectedExerciseId(
          routineExercise,
          substitution ? [substitution] : [],
        )
      ) {
        throw new BadRequestException(
          'exerciseId does not match the exercise for this slot',
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

      const existing = await tx.setLog.findUnique({
        where,
        select: {
          id: true,
          reps: true,
          weight: true,
          isCompleted: true,
          kind: true,
        },
      });
      // LIVE-12: a new set starts as its prescription's kind.
      const newKind = existing
        ? undefined
        : (dto.kind ??
          prescribedSetKind(
            session.snapshot?.payload,
            routineExercise.id,
            dto.setNumber,
            routineExercise.sets,
          ));
      // LIVE-15: a new set above the prescription is an extra set.
      if (!existing) {
        const prescribed = prescribedSetCount(
          session.snapshot?.payload,
          routineExercise.id,
          routineExercise.sets,
        );
        if (dto.setNumber > prescribed) {
          const refusal = extraSetRefusal(
            dto.setNumber,
            prescribed,
            await highestLoggedSet(tx, sessionId, routineExercise.id),
          );
          if (refusal) throw new BadRequestException(refusal);
        }
      }
      const priorSets = await tx.setLog.findMany({
        where: {
          exerciseId: dto.exerciseId,
          isCompleted: true,
          ...(existing ? { id: { not: existing.id } } : {}),
          session: {
            userId,
            OR: [{ status: WorkoutSessionStatus.COMPLETED }, { id: sessionId }],
          },
        },
        select: { reps: true, weight: true, isCompleted: true, kind: true },
      });

      const upserted = await tx.setLog.upsert({
        where,
        update: {
          reps: dto.reps,
          weight: dto.weight,
          rpe: dto.rpe,
          isCompleted: dto.isCompleted ?? undefined,
          completedAt: dto.isCompleted === undefined ? undefined : completedAt,
          exerciseId: dto.exerciseId,
          kind: dto.kind,
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
          kind: newKind,
        },
        select: {
          id: true,
          sessionId: true,
          routineExerciseId: true,
          sourceRoutineExerciseId: true,
          exerciseId: true,
          setNumber: true,
          reps: true,
          weight: true,
          rpe: true,
          isCompleted: true,
          kind: true,
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

      const earnedRecords = earnedPersonalRecords({
        candidate: upserted,
        existing: existing as RecordSet | null,
        previous: recordFrontier(priorSets),
        exerciseId: dto.exerciseId,
        exerciseName:
          substitution?.exercise.name ?? routineExercise.exercise.name,
      });

      return {
        setLog: toSetLogResponse(sessionId, upserted),
        earnedRecords,
      };
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
        select: {
          id: true,
          status: true,
          routineDayId: true,
          snapshot: { select: { payload: true } },
        },
      });
      if (!session) {
        throw new NotFoundException('Workout session not found');
      }
      if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
        throw new BadRequestException(
          'Cannot modify set logs for a finished session',
        );
      }

      // LIVE-15: only the last extra set can be taken back.
      const liveSets = await tx.routineExerciseSet.findMany({
        where: {
          routineExerciseId,
          routineExercise: { routineDayId: session.routineDayId! },
        },
        select: { setNumber: true },
      });
      const refusal = removeSetRefusal(
        setNumber,
        prescribedSetCount(
          session.snapshot?.payload,
          routineExerciseId,
          liveSets,
        ),
        await highestLoggedSet(tx, sessionId, routineExerciseId),
      );
      if (refusal) throw new BadRequestException(refusal);

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
