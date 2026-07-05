const ROUTINE_SET_SELECT = {
  setNumber: true,
  repType: true,
  reps: true,
  minReps: true,
  maxReps: true,
  weight: true,
  rir: true,
} as const;

const ROUTINE_EXERCISE_SELECT = {
  id: true,
  order: true,
  restSeconds: true,
  note: true,
  progressionScheme: true,
  minWeightIncrement: true,
  exercise: { select: { id: true, name: true } },
  sets: {
    select: ROUTINE_SET_SELECT,
    orderBy: { setNumber: 'asc' },
  },
} as const;

const ROUTINE_DAY_SELECT = {
  id: true,
  dayOfWeek: true,
  order: true,
  exercises: {
    select: ROUTINE_EXERCISE_SELECT,
    orderBy: { order: 'asc' },
  },
} as const;

// Full routine shape with nested days/exercises/sets, used for reads and mutations.
export const ROUTINE_WITH_DAYS_SELECT = {
  id: true,
  userId: true,
  name: true,
  description: true,
  isPeriodized: true,
  isFavorite: true,
  isCompleted: true,
  createdAt: true,
  updatedAt: true,
  days: {
    select: ROUTINE_DAY_SELECT,
    orderBy: { order: 'asc' },
  },
} as const;

// Lightweight shape returned by favorite/completed toggles (no nested days).
export const ROUTINE_TOGGLE_SELECT = {
  id: true,
  userId: true,
  name: true,
  description: true,
  isPeriodized: true,
  isFavorite: true,
  isCompleted: true,
  createdAt: true,
  updatedAt: true,
} as const;
