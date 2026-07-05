import { Prisma } from '@prisma/client';
import {
  Routine,
  RoutineDay,
  RoutineExercise,
  RoutineSet,
} from '@sunsteel/contracts';
import { ROUTINE_WITH_DAYS_SELECT } from './routine.selects';

/**
 * Maps the Prisma result of `ROUTINE_WITH_DAYS_SELECT` to the shared
 * `Routine` response contract. This is the serialization boundary: it is the
 * one place that converts Prisma `Date` values into ISO strings and asserts,
 * at compile time, that the backend response matches `@sunsteel/contracts`.
 */
type RoutineWithDaysEntity = Prisma.RoutineGetPayload<{
  select: typeof ROUTINE_WITH_DAYS_SELECT;
}>;

type RoutineDayEntity = RoutineWithDaysEntity['days'][number];
type RoutineExerciseEntity = RoutineDayEntity['exercises'][number];
type RoutineSetEntity = RoutineExerciseEntity['sets'][number];

function toRoutineSet(s: RoutineSetEntity): RoutineSet {
  return {
    setNumber: s.setNumber,
    repType: s.repType,
    reps: s.reps,
    minReps: s.minReps,
    maxReps: s.maxReps,
    weight: s.weight,
    rir: s.rir,
  };
}

function toRoutineExercise(e: RoutineExerciseEntity): RoutineExercise {
  return {
    id: e.id,
    order: e.order,
    restSeconds: e.restSeconds,
    note: e.note,
    progressionScheme: e.progressionScheme,
    minWeightIncrement: e.minWeightIncrement,
    exercise: { id: e.exercise.id, name: e.exercise.name },
    sets: e.sets.map(toRoutineSet),
  };
}

function toRoutineDay(d: RoutineDayEntity): RoutineDay {
  return {
    id: d.id,
    dayOfWeek: d.dayOfWeek,
    order: d.order,
    exercises: d.exercises.map(toRoutineExercise),
  };
}

export function toRoutineResponse(r: RoutineWithDaysEntity): Routine {
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    description: r.description,
    isPeriodized: r.isPeriodized,
    isFavorite: r.isFavorite,
    isCompleted: r.isCompleted,
    days: r.days.map(toRoutineDay),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
