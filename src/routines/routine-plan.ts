import type { RoutineScheduleMode } from '@sunsteel/contracts';
import { readRoutineSetup } from './routine-versions';

/**
 * ROUT-15: the narrow shape of a routine's current training blocks that the
 * server-side planners need -- reminders (NOTIF-04), the partner schedule
 * (SOC-08) and moves and skips (SCHED-04/05) -- so they resolve a date through
 * the same `resolveRoutinePlan` the frontend schedule uses. Only weekdays are
 * read; nothing here needs a prescription.
 */
export const PLAN_BLOCKS_SELECT = {
  where: { supersededAt: null },
  orderBy: { startDate: 'asc' },
  select: {
    id: true,
    seriesId: true,
    revision: true,
    name: true,
    startDate: true,
    endDate: true,
    setup: true,
    days: { select: { dayOfWeek: true } },
  },
} as const;

/** The baseline days only; a block's working copy is read through its block. */
export const BASELINE_DAY_WEEKDAYS_SELECT = {
  where: { trainingBlockId: null },
  select: { dayOfWeek: true },
} as const;

export interface PlanBlockRow {
  id: string;
  seriesId: string;
  revision: number;
  name: string;
  startDate: string;
  endDate: string;
  setup: unknown;
  days: { dayOfWeek: number | null }[];
}

export interface PlanBlock {
  id: string;
  seriesId: string;
  revision: number;
  name: string;
  startDate: string;
  endDate: string;
  scheduleMode: RoutineScheduleMode;
  restDays: number[];
  rotationWeekdays: number[];
  nextRotationDayId: null;
  days: { dayOfWeek: number | null }[];
}

export function toPlanBlocks(rows: readonly PlanBlockRow[]): PlanBlock[] {
  return rows.map((row) => {
    const setup = readRoutineSetup(row.setup);
    const rotation = setup.scheduleMode === 'ROTATION';
    return {
      id: row.id,
      seriesId: row.seriesId,
      revision: row.revision,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      scheduleMode: setup.scheduleMode,
      restDays: rotation ? [] : [...setup.restDays],
      rotationWeekdays: rotation ? [...(setup.rotationWeekdays ?? [])] : [],
      nextRotationDayId: null,
      days: row.days,
    };
  });
}
