import type { RoutineVersionSetup } from "@sunsteel/contracts";

/**
 * ROUT-15/ROUT-16: a plan's working copy (a training-block revision's or a
 * deload's) -- real days, exercises and sets marked
 * with the revision, created from its authored setup in the same write. A
 * session of a block day logs against these rows and progression advances
 * them, so the routine's baseline is never touched by training a block. A new
 * revision starts again from its own setup.
 */
export function workingCopyDays(routineId: string, setup: RoutineVersionSetup) {
  return {
    create: setup.days.map((day) => ({
      routine: { connect: { id: routineId } },
      dayOfWeek: day.dayOfWeek,
      name: day.name,
      order: day.order,
      exercises: {
        create: day.exercises.map((exercise) => ({
          exercise: { connect: { id: exercise.exercise.id } },
          order: exercise.order,
          restSeconds: exercise.restSeconds,
          note: exercise.note,
          progressionScheme: exercise.progressionScheme,
          minWeightIncrement: exercise.minWeightIncrement,
          ...(exercise.warmUpsFollowLoad ? { warmUpsFollowLoad: true } : {}),
          sets: {
            create: exercise.sets.map((set) => ({
              setNumber: set.setNumber,
              repType: set.repType,
              reps: set.reps ?? null,
              minReps: set.minReps ?? null,
              maxReps: set.maxReps ?? null,
              weight: set.weight ?? null,
              rir: set.rir ?? null,
              kind: set.kind ?? 'WORKING',
              ...(typeof set.warmUpShare === 'number'
                ? { warmUpShare: set.warmUpShare }
                : {}),
            })),
          },
        })),
      },
    })),
  };
}
