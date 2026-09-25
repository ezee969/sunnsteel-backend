const ROUTINE_SET_SELECT = {
  setNumber: true,
  repType: true,
  reps: true,
  minReps: true,
  maxReps: true,
  weight: true,
  rir: true,
  kind: true,
  warmUpShare: true,
} as const;

const ROUTINE_EXERCISE_SELECT = {
  id: true,
  order: true,
  restSeconds: true,
  note: true,
  progressionScheme: true,
  minWeightIncrement: true,
  warmUpsFollowLoad: true,
  exercise: { select: { id: true, name: true } },
  sets: {
    select: ROUTINE_SET_SELECT,
    orderBy: { setNumber: 'asc' },
  },
} as const;

export const ROUTINE_DAY_SELECT = {
  id: true,
  dayOfWeek: true,
  name: true,
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
  scheduleMode: true,
  restDays: true,
  rotationWeekdays: true,
  visibility: true,
  // TRUST-04: a moderator's hide, reported to the owner and applied to
  // everybody else by `canViewRoutine`.
  moderationHiddenAt: true,
  // ROUT-07: owner-declared classification.
  goal: true,
  experienceLevel: true,
  // ROUT-06: what this routine was cloned from. The source's own visibility
  // and its author's PROF-06 routines rule come with it, because the lineage
  // is resolved through the same ROUT-04 rule as any other read of it.
  clonedAt: true,
  clonedFromRoutineId: true,
  clonedFromRoutine: {
    select: { id: true, visibility: true, moderationHiddenAt: true },
  },
  clonedFromUser: {
    select: {
      id: true,
      username: true,
      name: true,
      lastName: true,
      avatarUrl: true,
      routinesVisibility: true,
    },
  },
  createdAt: true,
  updatedAt: true,
  // ROUT-15: the baseline only. A training block's working-copy days share
  // the table and are read through `ROUTINE_OWNER_SELECT`'s `trainingBlocks`.
  days: {
    where: { trainingBlockId: null, temporaryOverrideId: null },
    select: ROUTINE_DAY_SELECT,
    orderBy: { order: 'asc' },
  },
} as const;

/**
 * ROUT-15: the owner's own read, which also carries every current block
 * revision with its working-copy days, so the frontend resolves what a date
 * trains with `resolveRoutinePlan` from the routine it already has.
 */
export const ROUTINE_OWNER_SELECT = {
  ...ROUTINE_WITH_DAYS_SELECT,
  trainingBlocks: {
    where: { supersededAt: null },
    // Blocks of one routine never overlap, so the start date orders them.
    orderBy: { startDate: 'asc' },
    select: {
      id: true,
      seriesId: true,
      revision: true,
      name: true,
      startDate: true,
      endDate: true,
      setup: true,
      days: {
        select: ROUTINE_DAY_SELECT,
        orderBy: { order: 'asc' },
      },
    },
  },
  // ROUT-16: the latest deloads, each with its own working-copy days.
  temporaryOverrides: {
    orderBy: { startDate: 'desc' },
    take: 26,
    select: {
      id: true,
      kind: true,
      startDate: true,
      endDate: true,
      setup: true,
      sourceTrainingBlockSeriesId: true,
      days: {
        select: ROUTINE_DAY_SELECT,
        orderBy: { order: 'asc' },
      },
    },
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
