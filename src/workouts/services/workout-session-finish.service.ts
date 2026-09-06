import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RepType } from '@prisma/client';
import { DatabaseService } from '../../database/database.service';
import { FinishWorkoutDto } from '../dto/finish-workout.dto';
import { buildWorkoutSessionSelect } from '../workout-session.selects';
import { lockTrainingAccount } from '../analytics/analytics-lock';
import { ensureSessionSnapshot } from '../analytics/session-snapshot';
import {
  applyContribution,
  summarizeSession,
} from '../analytics/analytics-writer';

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
          return tx.workoutSession.findUniqueOrThrow({
            where: { id },
            select: buildWorkoutSessionSelect(),
          });
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
        if (status === 'COMPLETED') {
          const routineDay = snapshot.routineDay;
          const logs = await tx.setLog.findMany({ where: { sessionId: id } });
          const logKey = (reId: string, setNumber: number) =>
            `${reId}#${setNumber}`;
          const logMap = new Map<
            string,
            { reps: number | null; weight: number | null; isCompleted: boolean }
          >();
          for (const l of logs) {
            logMap.set(
              logKey(
                l.sourceRoutineExerciseId ?? l.routineExerciseId!,
                l.setNumber,
              ),
              {
                reps: l.reps ?? null,
                weight: typeof l.weight === 'number' ? l.weight : null,
                isCompleted: l.isCompleted,
              },
            );
          }

          const updates: Array<{
            routineExerciseId: string;
            setNumber: number;
            newWeight: number;
          }> = [];

          const targetFor = (set: {
            repType: RepType;
            reps: number | null | undefined;
            minReps: number | null | undefined;
            maxReps: number | null | undefined;
          }) => {
            if (set.repType === RepType.RANGE) return set.maxReps ?? null;
            return set.reps ?? null;
          };

          for (const ex of routineDay?.exercises ?? []) {
            const scheme = ex.progressionScheme;
            const inc = ex.minWeightIncrement ?? 2.5;

            if (scheme === 'DOUBLE_PROGRESSION') {
              // progress if ALL sets hit or exceed target
              let allHit = true;
              for (const s of ex.sets) {
                const log = logMap.get(logKey(ex.id, s.setNumber));
                const target = targetFor({
                  repType: s.repType,
                  reps: s.reps ?? null,
                  minReps: s.minReps ?? null,
                  maxReps: s.maxReps ?? null,
                });
                const reps = log?.reps ?? null;
                const hit =
                  typeof target === 'number' &&
                  typeof reps === 'number' &&
                  reps >= target;
                if (!hit) {
                  allHit = false;
                  break;
                }
              }
              if (allHit) {
                for (const s of ex.sets) {
                  const log = logMap.get(logKey(ex.id, s.setNumber));
                  const baseFromLog =
                    typeof log?.weight === 'number' ? log.weight : undefined;
                  const current =
                    typeof baseFromLog === 'number'
                      ? baseFromLog
                      : typeof s.weight === 'number'
                        ? s.weight
                        : 0;
                  updates.push({
                    routineExerciseId: ex.id,
                    setNumber: s.setNumber,
                    newWeight: current + inc,
                  });
                }
              } else {
                for (const s of ex.sets) {
                  const log = logMap.get(logKey(ex.id, s.setNumber));
                  if (typeof log?.weight === 'number') {
                    updates.push({
                      routineExerciseId: ex.id,
                      setNumber: s.setNumber,
                      newWeight: log.weight,
                    });
                  }
                }
              }
            } else if (scheme === 'DYNAMIC_DOUBLE_PROGRESSION') {
              for (const s of ex.sets) {
                const log = logMap.get(logKey(ex.id, s.setNumber));
                const target = targetFor({
                  repType: s.repType,
                  reps: s.reps ?? null,
                  minReps: s.minReps ?? null,
                  maxReps: s.maxReps ?? null,
                });
                const reps = log?.reps ?? null;
                const hit =
                  typeof target === 'number' &&
                  typeof reps === 'number' &&
                  reps >= target;
                if (hit) {
                  const baseFromLog =
                    typeof log?.weight === 'number' ? log.weight : undefined;
                  const current =
                    typeof baseFromLog === 'number'
                      ? baseFromLog
                      : typeof s.weight === 'number'
                        ? s.weight
                        : 0;
                  updates.push({
                    routineExerciseId: ex.id,
                    setNumber: s.setNumber,
                    newWeight: current + inc,
                  });
                } else if (typeof log?.weight === 'number') {
                  updates.push({
                    routineExerciseId: ex.id,
                    setNumber: s.setNumber,
                    newWeight: log.weight,
                  });
                }
              }
            } else {
              for (const s of ex.sets) {
                const log = logMap.get(logKey(ex.id, s.setNumber));
                if (typeof log?.weight === 'number') {
                  updates.push({
                    routineExerciseId: ex.id,
                    setNumber: s.setNumber,
                    newWeight: log.weight,
                  });
                }
              }
            }
          }

          // Apply updates atomically with the claimed finish
          await Promise.all(
            updates.map((u) =>
              tx.routineExerciseSet.update({
                where: {
                  routineExerciseId_setNumber: {
                    routineExerciseId: u.routineExerciseId,
                    setNumber: u.setNumber,
                  },
                },
                data: { weight: u.newWeight },
                select: { id: true },
              }),
            ),
          );

          const summary = await summarizeSession(tx, id);
          const active = await tx.workoutAnalyticsProjection.findFirst({
            where: { userId, active: true, state: 'READY' },
          });
          if (active) await applyContribution(tx, active, summary);
          // BUILDING generations consume this finish through their ordered tail.
        }
        return tx.workoutSession.findUniqueOrThrow({
          where: { id },
          select: buildWorkoutSessionSelect(),
        });
      },
      { timeout: 15000 },
    );
  }
}
