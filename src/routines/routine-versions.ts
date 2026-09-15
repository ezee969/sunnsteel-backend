import { BadRequestException } from '@nestjs/common';
import {
  REP_TYPES,
  ROUTINE_SCHEDULE_MODES,
  ROUTINE_VERSION_NAME_MAX,
  type RoutineSet,
  type RoutineVersionDay,
  type RoutineVersionExercise,
  type RoutineVersionSetup,
} from '@sunsteel/contracts';
import type { RoutineWithDaysEntity } from './routine.mapper';

/**
 * ROUT-08: what a version preserves — everything a routine edit can change —
 * captured from the stored routine. Ids are left out on purpose: every edit
 * replaces the days, so only the setup itself is meaningful later.
 */
export function captureRoutineSetup(
  routine: RoutineWithDaysEntity,
): RoutineVersionSetup {
  return {
    name: routine.name,
    description: routine.description ?? null,
    scheduleMode: routine.scheduleMode,
    restDays: [...routine.restDays],
    rotationWeekdays: [...routine.rotationWeekdays],
    days: routine.days.map(
      (day): RoutineVersionDay => ({
        dayOfWeek: day.dayOfWeek,
        name: day.name,
        order: day.order,
        exercises: day.exercises.map(
          (exercise): RoutineVersionExercise => ({
            exercise: { id: exercise.exercise.id, name: exercise.exercise.name },
            order: exercise.order,
            restSeconds: exercise.restSeconds,
            note: exercise.note ?? null,
            progressionScheme: exercise.progressionScheme,
            minWeightIncrement: exercise.minWeightIncrement,
            sets: exercise.sets.map(
              (set): RoutineSet => ({
                setNumber: set.setNumber,
                repType: set.repType,
                reps: set.reps,
                minReps: set.minReps,
                maxReps: set.maxReps,
                weight: set.weight,
                rir: set.rir,
              }),
            ),
          }),
        ),
      }),
    ),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A stored setup, checked before it is served or restored. Versions are
 * written only by `captureRoutineSetup`, so a failure here means corrupt data.
 */
export function readRoutineSetup(payload: unknown): RoutineVersionSetup {
  const setup = payload as RoutineVersionSetup;
  const valid =
    isRecord(payload) &&
    typeof setup.name === 'string' &&
    (ROUTINE_SCHEDULE_MODES as readonly string[]).includes(
      setup.scheduleMode,
    ) &&
    Array.isArray(setup.restDays) &&
    // SCHED-06: absent in versions saved before it.
    (setup.rotationWeekdays === undefined ||
      Array.isArray(setup.rotationWeekdays)) &&
    Array.isArray(setup.days) &&
    setup.days.every(
      (day) =>
        isRecord(day) &&
        Array.isArray(day.exercises) &&
        day.exercises.every(
          (exercise) =>
            isRecord(exercise) &&
            isRecord(exercise.exercise) &&
            typeof exercise.exercise.id === 'string' &&
            Array.isArray(exercise.sets) &&
            exercise.sets.every(
              (set) =>
                isRecord(set) &&
                (REP_TYPES as readonly string[]).includes(set.repType),
            ),
        ),
    );
  if (!valid) throw new Error('Unreadable routine version setup');
  return setup;
}

/** The routine edit that restores a setup, in the update DTO's shape. */
export function setupToRoutineUpdate(setup: RoutineVersionSetup) {
  return {
    name: setup.name,
    description: setup.description ?? undefined,
    scheduleMode: setup.scheduleMode,
    restDays: setup.scheduleMode === 'WEEKLY' ? [...setup.restDays] : [],
    rotationWeekdays:
      setup.scheduleMode === 'ROTATION'
        ? [...(setup.rotationWeekdays ?? [])]
        : [],
    days: setup.days.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      name: day.name,
      order: day.order,
      exercises: day.exercises.map((exercise) => ({
        exerciseId: exercise.exercise.id,
        order: exercise.order,
        restSeconds: exercise.restSeconds,
        note: exercise.note ?? undefined,
        progressionScheme: exercise.progressionScheme,
        minWeightIncrement: exercise.minWeightIncrement,
        sets: exercise.sets.map((set) => ({ ...set })),
      })),
    })),
  };
}

/** Every catalog exercise a setup programs, once each. */
export function setupExerciseIds(setup: RoutineVersionSetup): string[] {
  return [
    ...new Set(
      setup.days.flatMap((day) =>
        day.exercises.map((exercise) => exercise.exercise.id),
      ),
    ),
  ];
}

/** A version's optional name: trimmed, blank is none, at most the maximum. */
export function normalizeVersionName(name: string | null | undefined) {
  const trimmed = name?.trim() || null;
  if (trimmed && trimmed.length > ROUTINE_VERSION_NAME_MAX) {
    throw new BadRequestException(
      `Version names have at most ${ROUTINE_VERSION_NAME_MAX} characters`,
    );
  }
  return trimmed;
}
