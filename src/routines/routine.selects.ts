type RoutineSelectOptions = {
  includeRoutineProgramFields?: boolean;
  includeProgramTrainingDays?: boolean;
  includeProgramStyle?: boolean;
  includeExerciseProgramFields?: boolean;
};

const ROUTINE_SET_SELECT = {
  setNumber: true,
  repType: true,
  reps: true,
  minReps: true,
  maxReps: true,
  weight: true,
  rir: true,
} as const;

function buildRoutineExerciseSelect(includeProgramFields = false) {
  return {
    id: true,
    order: true,
    restSeconds: true,
    note: true,
    progressionScheme: true,
    minWeightIncrement: true,
    ...(includeProgramFields
      ? {
          programTMKg: true,
          programRoundingKg: true,
          programStyle: true,
        }
      : {}),
    exercise: { select: { id: true, name: true } },
    sets: {
      select: ROUTINE_SET_SELECT,
      orderBy: { setNumber: 'asc' },
    },
  } as const;
}

function buildRoutineDaySelect(includeExerciseProgramFields = false) {
  return {
    id: true,
    dayOfWeek: true,
    order: true,
    exercises: {
      select: buildRoutineExerciseSelect(includeExerciseProgramFields),
      orderBy: { order: 'asc' },
    },
  } as const;
}

function buildRoutineSelect(options: RoutineSelectOptions = {}) {
  return {
    id: true,
    userId: true,
    name: true,
    description: true,
    isPeriodized: true,
    isFavorite: true,
    isCompleted: true,
    ...(options.includeRoutineProgramFields
      ? {
          programWithDeloads: true,
          programDurationWeeks: true,
          programStartWeek: true,
          programStartDate: true,
          programEndDate: true,
          programTimezone: true,
        }
      : {}),
    ...(options.includeProgramTrainingDays
      ? {
          programTrainingDaysOfWeek: true,
        }
      : {}),
    ...(options.includeProgramStyle
      ? {
          programStyle: true,
        }
      : {}),
    createdAt: true,
    updatedAt: true,
    days: {
      select: buildRoutineDaySelect(!!options.includeExerciseProgramFields),
      orderBy: { order: 'asc' },
    },
  } as const;
}

export const ROUTINE_MUTATION_SELECT = buildRoutineSelect({
  includeRoutineProgramFields: true,
  includeProgramTrainingDays: true,
  includeProgramStyle: true,
  includeExerciseProgramFields: true,
});

export const ROUTINE_UPDATE_SELECT = buildRoutineSelect({
  includeRoutineProgramFields: true,
  includeProgramTrainingDays: true,
  includeProgramStyle: true,
});

export const ROUTINE_WITH_PROGRAM_SELECT = buildRoutineSelect({
  includeRoutineProgramFields: true,
  includeProgramStyle: true,
});

export const ROUTINE_DETAIL_SELECT = buildRoutineSelect({
  includeRoutineProgramFields: true,
  includeProgramStyle: true,
  includeExerciseProgramFields: true,
});

export const ROUTINE_COMPLETED_SELECT = buildRoutineSelect({
  includeProgramStyle: true,
});

export const ROUTINE_FAVORITE_TOGGLE_SELECT = {
  id: true,
  userId: true,
  name: true,
  description: true,
  isPeriodized: true,
  isFavorite: true,
  isCompleted: true,
  programStyle: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const ROUTINE_COMPLETED_TOGGLE_SELECT = {
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
