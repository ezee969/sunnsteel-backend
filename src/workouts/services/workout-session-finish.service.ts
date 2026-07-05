import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RepType, WorkoutSessionStatus } from '@prisma/client';
import { DatabaseService } from '../../database/database.service';
import { FinishWorkoutDto } from '../dto/finish-workout.dto';
import { buildWorkoutSessionSelect } from '../workout-session.selects';

@Injectable()
export class WorkoutSessionFinishService {
  constructor(private readonly db: DatabaseService) {}

  async finishSession(userId: string, id: string, dto: FinishWorkoutDto) {
    const session = await this.db.workoutSession.findFirst({
      where: { id, userId },
      select: { id: true, startedAt: true, status: true, routineDayId: true },
    });
    if (!session) {
      throw new NotFoundException('Workout session not found');
    }
    if (session.status !== WorkoutSessionStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Only in-progress sessions can be finished',
      );
    }

    const now = new Date();
    const durationSec = Math.max(
      0,
      Math.round(
        (now.getTime() - new Date(session.startedAt).getTime()) / 1000,
      ),
    );

    const status =
      dto.status === 'ABORTED'
        ? WorkoutSessionStatus.ABORTED
        : WorkoutSessionStatus.COMPLETED;

    // Apply progression only when completed
    if (status === WorkoutSessionStatus.COMPLETED) {
      try {
        // Fetch routine configuration for this day
        const routineDay = await this.db.routineDay.findFirst({
          where: { id: session.routineDayId },
          select: {
            id: true,
            exercises: {
              select: {
                id: true,
                progressionScheme: true,
                minWeightIncrement: true,
                sets: {
                  select: {
                    setNumber: true,
                    repType: true,
                    reps: true,
                    minReps: true,
                    maxReps: true,
                    weight: true,
                  },
                  orderBy: { setNumber: 'asc' },
                },
              },
              orderBy: { order: 'asc' },
            },
          },
        });

        // Fetch performed set logs for this session
        const logs = await this.db.setLog.findMany({
          where: { sessionId: session.id },
          select: {
            routineExerciseId: true,
            setNumber: true,
            reps: true,
            weight: true,
            isCompleted: true,
          },
        });

        const logKey = (reId: string, setNumber: number) => `${reId}#${setNumber}`;
        const logMap = new Map<
          string,
          { reps: number | null; weight: number | null; isCompleted: boolean }
        >();
        for (const l of logs) {
          logMap.set(logKey(l.routineExerciseId, l.setNumber), {
            reps: l.reps ?? null,
            weight: typeof l.weight === 'number' ? l.weight : null,
            isCompleted: l.isCompleted,
          });
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

        // Apply updates
        await Promise.all(
          updates.map((u) =>
            this.db.routineExerciseSet.update({
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
      } catch {
        // Fail-safe: do not block finishing if progression cannot be computed
      }
    }

    return this.db.workoutSession.update({
      where: { id },
      data: { status, endedAt: now, durationSec, notes: dto.notes },
      select: buildWorkoutSessionSelect(),
    });
  }
}
