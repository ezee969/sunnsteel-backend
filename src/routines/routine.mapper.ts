import { Prisma } from '@prisma/client';
import {
  Routine,
  RoutineDay,
  RoutineExercise,
  RoutineLineage,
  RoutineSet,
  RoutineTemporaryOverridePlan,
  RoutineTrainingBlockPlan,
} from '@sunsteel/contracts';
import {
  ROUTINE_OWNER_SELECT,
  ROUTINE_WITH_DAYS_SELECT,
} from './routine.selects';
import { readRoutineSetup } from './routine-versions';

/**
 * Maps the Prisma result of `ROUTINE_WITH_DAYS_SELECT` to the shared
 * `Routine` response contract. This is the serialization boundary: it is the
 * one place that converts Prisma `Date` values into ISO strings and asserts,
 * at compile time, that the backend response matches `@sunsteel/contracts`.
 */
export type RoutineWithDaysEntity = Prisma.RoutineGetPayload<{
  select: typeof ROUTINE_WITH_DAYS_SELECT;
}>;

export type RoutineOwnerEntity = Prisma.RoutineGetPayload<{
  select: typeof ROUTINE_OWNER_SELECT;
}>;
type TrainingBlockPlanEntity = RoutineOwnerEntity['trainingBlocks'][number];
type TemporaryOverridePlanEntity =
  RoutineOwnerEntity['temporaryOverrides'][number];

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

export function toRoutineDay(d: RoutineDayEntity): RoutineDay {
  return {
    id: d.id,
    dayOfWeek: d.dayOfWeek,
    name: d.name,
    order: d.order,
    exercises: d.exercises.map(toRoutineExercise),
  };
}

/**
 * ROUT-15: a current block revision as a plan. Its schedule comes from the
 * authored setup, normalized the way a restore normalizes it; its days are the
 * working copy. `nextRotationDayId` is resolved by the caller, like the
 * baseline's, and is null on a weekly block.
 */
export function toTrainingBlockPlan(
  block: TrainingBlockPlanEntity,
  nextRotationDayId: string | null = null,
): RoutineTrainingBlockPlan {
  const setup = readRoutineSetup(block.setup);
  const rotation = setup.scheduleMode === 'ROTATION';
  return {
    id: block.id,
    seriesId: block.seriesId,
    revision: block.revision,
    name: block.name,
    startDate: block.startDate,
    endDate: block.endDate,
    scheduleMode: setup.scheduleMode,
    restDays: rotation ? [] : [...setup.restDays],
    rotationWeekdays: rotation ? [...(setup.rotationWeekdays ?? [])] : [],
    nextRotationDayId: rotation ? nextRotationDayId : null,
    days: block.days.map(toRoutineDay),
  };
}

/**
 * ROUT-16: a deload as a plan. Its schedule is the lightened plan's, copied
 * into its setup; its rotation continues the underlying plan, so its next day
 * is the copy's day with the order the underlying plan would train next.
 */
export function toTemporaryOverridePlan(
  row: TemporaryOverridePlanEntity,
  underlyingNextOrder: number | null,
): RoutineTemporaryOverridePlan {
  const setup = readRoutineSetup(row.setup);
  const rotation = setup.scheduleMode === 'ROTATION';
  const days = row.days.map(toRoutineDay);
  const next = rotation
    ? (days.find((day) => day.order === underlyingNextOrder) ?? days[0] ?? null)
    : null;
  return {
    id: row.id,
    kind: row.kind,
    startDate: row.startDate,
    endDate: row.endDate,
    scheduleMode: setup.scheduleMode,
    restDays: rotation ? [] : [...setup.restDays],
    rotationWeekdays: rotation ? [...(setup.rotationWeekdays ?? [])] : [],
    nextRotationDayId: next?.id ?? null,
    days,
  };
}

/**
 * `nextRotationDayId` is resolved by the caller for ROTATION routines (it needs
 * the last completed session); WEEKLY routines always report null.
 */
export function toRoutineResponse(
  r: RoutineWithDaysEntity,
  nextRotationDayId: string | null = null,
  lineage: RoutineLineage | null = null,
  trainingBlocks?: RoutineTrainingBlockPlan[],
  temporaryOverrides?: RoutineTemporaryOverridePlan[],
): Routine {
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    description: r.description,
    isPeriodized: r.isPeriodized,
    isFavorite: r.isFavorite,
    isCompleted: r.isCompleted,
    scheduleMode: r.scheduleMode,
    nextRotationDayId: r.scheduleMode === 'ROTATION' ? nextRotationDayId : null,
    restDays: r.restDays,
    rotationWeekdays: r.rotationWeekdays,
    visibility: r.visibility,
    // TRUST-04: the owner's own read, and only theirs -- every other read of
    // a hidden routine is refused before it reaches a mapper.
    isHiddenByModeration: r.moderationHiddenAt !== null,
    goal: r.goal,
    experienceLevel: r.experienceLevel,
    ...(lineage ? { lineage } : {}),
    days: r.days.map(toRoutineDay),
    ...(trainingBlocks ? { trainingBlocks } : {}),
    ...(temporaryOverrides ? { temporaryOverrides } : {}),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
