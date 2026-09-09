import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ProgressionChange } from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { lockTrainingAccount } from '../analytics/analytics-lock';
import {
  applyContribution,
  summarizeSession,
} from '../analytics/analytics-writer';
import {
  readProgressionEvents,
  writeProgressionEvents,
} from '../analytics/progression-events';
import { ensureSessionSnapshot } from '../analytics/session-snapshot';
import { FinishWorkoutDto } from '../dto/finish-workout.dto';
import {
  buildProgressionOutcome,
  type ProgressionLog,
} from '../progression-changes';
import { buildWorkoutSessionSelect } from '../workout-session.selects';

@Injectable()
export class WorkoutSessionFinishService {
  constructor(private readonly db: DatabaseService) {}

  async finishSession(userId: string, id: string, dto: FinishWorkoutDto) {
    return this.db.$transaction(
      async (tx) => {
        await lockTrainingAccount(tx, userId);
        const session = await tx.workoutSession.findFirst({
          where: { id, userId },
        });
        if (!session) throw new NotFoundException('Workout session not found');
        const status = dto.status === 'ABORTED' ? 'ABORTED' : 'COMPLETED';

        if (session.status !== 'IN_PROGRESS') {
          if (session.status !== status)
            throw new BadRequestException(
              'Session already finished with a different status',
            );
          const progressionChanges =
            status === 'COMPLETED'
              ? await readProgressionEvents(
                  tx,
                  id,
                  (
                    (await ensureSessionSnapshot(tx, id)).routineDay.exercises ??
                    []
                  ).map((exercise) => exercise.id),
                )
              : [];
          return {
            session: await tx.workoutSession.findUniqueOrThrow({
              where: { id },
              select: buildWorkoutSessionSelect(),
            }),
            progressionChanges,
          };
        }

        const now = new Date();
        const claimed = await tx.workoutSession.updateMany({
          where: { id, userId, status: 'IN_PROGRESS' },
          data: {
            status,
            endedAt: now,
            durationSec: Math.max(
              0,
              Math.round((now.getTime() - session.startedAt.getTime()) / 1000),
            ),
            notes: dto.notes,
          },
        });
        if (claimed.count !== 1)
          throw new BadRequestException('Session transition was not claimed');

        const snapshot = await ensureSessionSnapshot(tx, id);
        let progressionChanges: ProgressionChange[] = [];
        if (status === 'COMPLETED') {
          const logs = await tx.setLog.findMany({ where: { sessionId: id } });
          const progressionLogs: ProgressionLog[] = logs.flatMap((log) => {
            const routineExerciseId =
              log.sourceRoutineExerciseId ?? log.routineExerciseId;
            if (!routineExerciseId) return [];
            return [
              {
                routineExerciseId,
                setNumber: log.setNumber,
                reps: log.reps ?? null,
                weight: typeof log.weight === 'number' ? log.weight : null,
                isCompleted: log.isCompleted,
              },
            ];
          });
          const outcome = buildProgressionOutcome(
            snapshot.routineDay.exercises ?? [],
            progressionLogs,
          );
          progressionChanges = outcome.changes;

          await Promise.all(
            outcome.updates.map((update) =>
              tx.routineExerciseSet.update({
                where: {
                  routineExerciseId_setNumber: {
                    routineExerciseId: update.routineExerciseId,
                    setNumber: update.setNumber,
                  },
                },
                data: { weight: update.newWeight },
                select: { id: true },
              }),
            ),
          );
          await writeProgressionEvents(
            tx,
            userId,
            id,
            now,
            progressionChanges,
          );

          const summary = await summarizeSession(tx, id);
          const active = await tx.workoutAnalyticsProjection.findFirst({
            where: { userId, active: true, state: 'READY' },
          });
          if (active) await applyContribution(tx, active, summary);
          // BUILDING generations consume this finish through their ordered tail.
        }

        return {
          session: await tx.workoutSession.findUniqueOrThrow({
            where: { id },
            select: buildWorkoutSessionSelect(),
          }),
          progressionChanges,
        };
      },
      { timeout: 15000 },
    );
  }
}
