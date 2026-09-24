import type { SharedRoutineSummary } from '@sunsteel/contracts';

/**
 * The compact shape of one routine as somebody other than its owner sees it:
 * what it programs, never anything that was trained against it. `ROUT-04`'s
 * member list and `PROF-08`'s featured slot both read routines this way, so
 * the select and the mapping live in one place rather than twice.
 */
export const ROUTINE_SUMMARY_SELECT = {
  id: true,
  name: true,
  description: true,
  scheduleMode: true,
  visibility: true,
  moderationHiddenAt: true,
  updatedAt: true,
  // ROUT-15: the baseline, never a training block's working copy.
  days: {
    where: { trainingBlockId: null, temporaryOverrideId: null },
    select: { _count: { select: { exercises: true } } },
  },
} as const;

export interface RoutineSummaryEntity {
  id: string;
  name: string;
  description: string | null;
  scheduleMode: SharedRoutineSummary['scheduleMode'];
  updatedAt: Date;
  days: { _count: { exercises: number } }[];
}

export function toSharedRoutineSummary(
  routine: RoutineSummaryEntity,
): SharedRoutineSummary {
  return {
    routineId: routine.id,
    name: routine.name,
    description: routine.description ?? null,
    scheduleMode: routine.scheduleMode,
    dayCount: routine.days.length,
    exerciseCount: routine.days.reduce(
      (total, day) => total + day._count.exercises,
      0,
    ),
    updatedAt: routine.updatedAt.toISOString(),
  };
}
