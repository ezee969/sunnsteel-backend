import { Prisma } from '@prisma/client';

export function buildWorkoutSessionSelect(includeLogs = false) {
  return {
    id: true,
    userId: true,
    routineId: true,
    routineDayId: true,
    status: true,
    startedAt: true,
    endedAt: true,
    durationSec: true,
    notes: true,
    lastActivityAt: true,
    createdAt: true,
    updatedAt: true,
    routine: {
      select: {
        id: true,
        name: true,
        description: true,
      },
    },
    routineDay: {
      select: {
        id: true,
        dayOfWeek: true,
        exercises: {
          select: {
            id: true,
            order: true,
            restSeconds: true,
            progressionScheme: true,
            minWeightIncrement: true,
            exercise: {
              select: {
                id: true,
                name: true,
                primaryMuscles: true,
                equipment: true,
              },
            },
            sets: {
              select: {
                id: true,
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
    },
    ...(includeLogs
      ? {
          setLogs: {
            select: {
              id: true,
              routineExerciseId: true,
              exerciseId: true,
              setNumber: true,
              reps: true,
              weight: true,
              rpe: true,
              isCompleted: true,
              completedAt: true,
              createdAt: true,
              updatedAt: true,
              exercise: {
                select: {
                  id: true,
                  name: true,
                  primaryMuscles: true,
                  equipment: true,
                },
              },
            },
            orderBy: [
              { routineExerciseId: Prisma.SortOrder.asc },
              { setNumber: Prisma.SortOrder.asc },
            ],
          },
        }
      : {}),
  } as const;
}

export const WORKOUT_SESSION_LIST_SELECT = {
  id: true,
  status: true,
  startedAt: true,
  endedAt: true,
  durationSec: true,
  notes: true,
  routine: { select: { id: true, name: true } },
  routineDay: { select: { dayOfWeek: true } },
} as const;

export function dayNameFrom(dayOfWeek: number): string {
  const names = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  return names[dayOfWeek] ?? '';
}
