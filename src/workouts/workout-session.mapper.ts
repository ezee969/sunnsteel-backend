import { readSnapshot } from './analytics/session-snapshot';
import { Prisma } from '@prisma/client';
import { SetLog, WorkoutSession } from '@sunsteel/contracts';
import { buildWorkoutSessionSelect } from './workout-session.selects';

/**
 * Serialization boundary for a single workout session: maps the Prisma result
 * of `buildWorkoutSessionSelect` to the shared `WorkoutSession` contract,
 * converting Date values to ISO strings. Handles both the with-logs and
 * without-logs selects (setLogs is optional).
 */
type WorkoutSessionEntity = Prisma.WorkoutSessionGetPayload<{
  select: ReturnType<typeof buildWorkoutSessionSelect>;
}>;

type SetLogEntity = NonNullable<WorkoutSessionEntity['setLogs']>[number];
type RoutineDayEntity = NonNullable<WorkoutSessionEntity['routineDay']>;

export function toSetLogResponse(
  sessionId: string,
  log: Omit<SetLogEntity, 'exercise'> | SetLogEntity,
): SetLog {
  return {
    id: log.id,
    sessionId,
    routineExerciseId: log.sourceRoutineExerciseId ?? log.routineExerciseId!,
    exerciseId: log.exerciseId,
    setNumber: log.setNumber,
    // Contract requires a number; a logged set without reps maps to 0.
    reps: log.reps ?? 0,
    weight: log.weight,
    rpe: log.rpe,
    isCompleted: log.isCompleted,
    completedAt: log.completedAt ? log.completedAt.toISOString() : null,
    createdAt: log.createdAt.toISOString(),
    updatedAt: log.updatedAt.toISOString(),
  };
}

function toRoutineDay(day: RoutineDayEntity): WorkoutSession['routineDay'] {
  return {
    id: day.id,
    dayOfWeek: day.dayOfWeek,
    exercises: day.exercises.map((e) => ({
      id: e.id,
      order: e.order,
      restSeconds: e.restSeconds,
      progressionScheme: e.progressionScheme,
      minWeightIncrement: e.minWeightIncrement,
      exercise: {
        id: e.exercise.id,
        name: e.exercise.name,
        primaryMuscles: e.exercise.primaryMuscles,
      },
      sets: e.sets.map((s) => ({
        id: s.id,
        setNumber: s.setNumber,
        repType: s.repType,
        reps: s.reps,
        minReps: s.minReps,
        maxReps: s.maxReps,
        weight: s.weight,
      })),
    })),
  };
}

export function toWorkoutSessionResponse(
  session: WorkoutSessionEntity,
): WorkoutSession {
  const snapshot = session.snapshot
    ? readSnapshot(session.snapshot.payload)
    : null;
  return {
    id: session.id,
    userId: session.userId,
    routineId: snapshot?.sourceRoutineId ?? session.routineId!,
    routineDayId: snapshot?.sourceRoutineDayId ?? session.routineDayId!,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    durationSec: session.durationSec,
    notes: session.notes,
    lastActivityAt: session.lastActivityAt
      ? session.lastActivityAt.toISOString()
      : null,
    routine: snapshot?.routine ?? {
      id: session.routine!.id,
      name: session.routine!.name,
      description: session.routine!.description,
    },
    routineDay: snapshot?.routineDay ?? toRoutineDay(session.routineDay!),
    setLogs: session.setLogs
      ? session.setLogs.map((log) => toSetLogResponse(session.id, log))
      : undefined,
  };
}
