import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type BlockComparisonLift,
  type BlockComparisonPeriod,
  type BlockComparisonPeriodKind,
  resolveRoutinePlan,
  TRAINING_BLOCK_COMPARISON_MAX_DAYS,
  type TrainingBlockComparisonResponse,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { localClock } from "../notifications/push/local-time";
import {
  type ReminderOverride,
  type ReminderRoutine,
  routinesPlannedOn,
} from "../notifications/push/training-days";
import {
  BASELINE_DAY_WEEKDAYS_SELECT,
  PLAN_BLOCKS_SELECT,
  PLAN_OVERRIDES_SELECT,
  toPlanBlocks,
  toPlanOverrides,
} from "../routines/routine-plan";
import { addCalendarDays, daysBetween } from "../schedule/schedule-overrides";
import {
  effortSignal,
  estimated1rm,
  type Half,
  type RepTargetFloors,
  repTargetSignal,
  type TrainingSignalSetRow,
  WorkoutTrainingSignalsService,
} from "./workout-training-signals.service";

const DAY_MS = 86_400_000;
const round1 = (value: number) => Math.round(value * 10) / 10;

export interface PeriodRange {
  kind: BlockComparisonPeriodKind;
  name: string | null;
  seriesId: string | null;
  startDate: string;
  endDate: string;
}

interface DatedBlock {
  seriesId: string;
  name: string;
  startDate: string;
  endDate: string;
}

/** Inclusive length of a date range. */
const lengthOf = (start: string, end: string) => daysBetween(start, end) + 1;

/** Keeps the latest `max` days of a range; reports whether it had to. */
function capRange(
  range: PeriodRange,
  max = TRAINING_BLOCK_COMPARISON_MAX_DAYS,
): { range: PeriodRange; truncated: boolean } {
  if (lengthOf(range.startDate, range.endDate) <= max) {
    return { range, truncated: false };
  }
  return {
    range: { ...range, startDate: addCalendarDays(range.endDate, -(max - 1)) },
    truncated: true,
  };
}

/**
 * PROG-11: the block, up to today while it runs, beside the block before it
 * on the same routine -- or, for the first block, the same number of days
 * before it began. A running block cuts the earlier period to the days it
 * has had so far, so both periods are the same length.
 */
export function comparisonPeriods(
  blocks: readonly DatedBlock[],
  seriesId: string,
  today: string,
): {
  current: PeriodRange;
  previous: PeriodRange;
  isRunning: boolean;
  truncated: boolean;
} {
  const sorted = [...blocks].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const block = sorted.find((candidate) => candidate.seriesId === seriesId);
  if (!block) throw new NotFoundException("Training block not found");
  if (block.startDate > today) {
    throw new BadRequestException(
      "A training block that has not started has nothing to compare",
    );
  }
  const isRunning = block.endDate >= today;
  const currentCap = capRange({
    kind: "TRAINING_BLOCK",
    name: block.name,
    seriesId: block.seriesId,
    startDate: block.startDate,
    endDate: isRunning ? today : block.endDate,
  });
  const current = currentCap.range;
  const elapsed = lengthOf(current.startDate, current.endDate);

  const earlier = sorted.filter((other) => other.endDate < block.startDate);
  const before = earlier[earlier.length - 1];
  let previous: PeriodRange;
  if (before) {
    const fullEnd = before.endDate;
    previous = {
      kind: "TRAINING_BLOCK",
      name: before.name,
      seriesId: before.seriesId,
      startDate: before.startDate,
      endDate: isRunning
        ? [fullEnd, addCalendarDays(before.startDate, elapsed - 1)].sort()[0]
        : fullEnd,
    };
  } else {
    const end = addCalendarDays(block.startDate, -1);
    previous = {
      kind: "BEFORE_BLOCK",
      name: null,
      seriesId: null,
      startDate: addCalendarDays(end, -(elapsed - 1)),
      endDate: end,
    };
  }
  const previousCap = capRange(previous);
  return {
    current,
    previous: previousCap.range,
    isRunning,
    truncated: currentCap.truncated || previousCap.truncated,
  };
}

/**
 * Days the plan in force had a workout on, from the period's start up to
 * today. Null when any of those dates falls to a rotation without training
 * weekdays: it has no dated plan, so there is no honest count.
 */
export function countPlannedWorkouts(
  routine: ReminderRoutine,
  overrides: readonly ReminderOverride[],
  range: PeriodRange,
  today: string,
): number | null {
  let planned = 0;
  for (
    let date = range.startDate;
    date <= range.endDate && date <= today;
    date = addCalendarDays(date, 1)
  ) {
    const plan = resolveRoutinePlan(routine, date);
    if (
      plan.scheduleMode === "ROTATION" &&
      plan.rotationWeekdays.length === 0
    ) {
      return null;
    }
    planned += routinesPlannedOn({
      date,
      routines: [routine],
      overrides: [...overrides],
      routineIdsTrainedOnDate: [],
    }).length;
  }
  return planned;
}

/** Each lift's best estimated 1RM in one period; deloads and bodyweight left out. */
function bestLifts(rows: readonly TrainingSignalSetRow[]) {
  const best = new Map<
    string,
    { name: string; value: BlockComparisonLift["current"] }
  >();
  for (const row of rows) {
    if (row.isDeload || !row.weight || row.weight <= 0 || !row.reps) continue;
    const estimated1rmKg = estimated1rm(row.weight, row.reps);
    const current = best.get(row.exerciseId);
    if (
      !current ||
      estimated1rmKg > current.value.estimated1rmKg ||
      (estimated1rmKg === current.value.estimated1rmKg &&
        row.weight > current.value.weightKg)
    ) {
      best.set(row.exerciseId, {
        name: row.exerciseName,
        value: { estimated1rmKg, weightKg: row.weight, reps: row.reps },
      });
    }
  }
  return best;
}

export function compareLifts(
  current: readonly TrainingSignalSetRow[],
  previous: readonly TrainingSignalSetRow[],
): BlockComparisonLift[] {
  const now = bestLifts(current);
  const before = bestLifts(previous);
  const lifts: BlockComparisonLift[] = [];
  for (const [exerciseId, entry] of now) {
    const earlier = before.get(exerciseId);
    if (!earlier) continue;
    const change = entry.value.estimated1rmKg - earlier.value.estimated1rmKg;
    lifts.push({
      exerciseId,
      exerciseName: entry.name,
      current: entry.value,
      previous: earlier.value,
      changeKg: round1(change),
      changePercent:
        earlier.value.estimated1rmKg > 0
          ? round1((change / earlier.value.estimated1rmKg) * 100)
          : 0,
    });
  }
  return lifts.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

/** Counts and totals of one period, before rep targets are attached. */
export function summarizePeriod(
  rows: readonly TrainingSignalSetRow[],
  range: PeriodRange,
  plannedWorkouts: number | null,
): Omit<BlockComparisonPeriod, "repTargets"> {
  const sessions = new Map<string, TrainingSignalSetRow>();
  let volumeKg = 0;
  for (const row of rows) {
    sessions.set(row.sessionId, row);
    if (row.weight && row.reps) volumeKg += row.weight * row.reps;
  }
  const workouts = [...sessions.values()];
  const days = lengthOf(range.startDate, range.endDate);
  const weeks = days / 7;
  return {
    ...range,
    days,
    plannedWorkouts,
    workouts: workouts.length,
    endedEarly: workouts.filter((row) => row.status === "ABORTED").length,
    deloads: workouts.filter((row) => row.isDeload).length,
    completedSets: rows.length,
    volumeKg: round1(volumeKg),
    perWeek: {
      workouts: round1(workouts.length / weeks),
      completedSets: round1(rows.length / weeks),
      volumeKg: round1(volumeKg / weeks),
    },
  };
}

/**
 * Assembles the comparison from one routine's completed sets, already
 * placed in a period by the owner-local date they ended.
 */
export function buildBlockComparison({
  routineId,
  today,
  periods,
  rows,
  floors,
  localDateOf,
  planned,
}: {
  routineId: string;
  today: string;
  periods: ReturnType<typeof comparisonPeriods>;
  rows: readonly TrainingSignalSetRow[];
  floors: RepTargetFloors;
  localDateOf: (at: Date) => string;
  planned: { current: number | null; previous: number | null };
}): TrainingBlockComparisonResponse {
  const inRange = (range: PeriodRange, date: string) =>
    date >= range.startDate && date <= range.endDate;
  const halfOf = (endedAt: Date): Half | null => {
    const date = localDateOf(endedAt);
    if (inRange(periods.current, date)) return "recent";
    if (inRange(periods.previous, date)) return "previous";
    return null;
  };
  const currentRows = rows.filter((row) => halfOf(row.endedAt) === "recent");
  const previousRows = rows.filter((row) => halfOf(row.endedAt) === "previous");
  const trained = rows.filter(
    (row) => !row.isDeload && halfOf(row.endedAt) !== null,
  );
  const targets = repTargetSignal(trained, floors, halfOf);
  return {
    routineId,
    today,
    isRunning: periods.isRunning,
    truncated: periods.truncated,
    current: {
      ...summarizePeriod(currentRows, periods.current, planned.current),
      repTargets: targets.recent,
    },
    previous: {
      ...summarizePeriod(previousRows, periods.previous, planned.previous),
      repTargets: targets.previous,
    },
    effort: effortSignal(trained, halfOf),
    lifts: compareLifts(currentRows, previousRows),
  };
}

@Injectable()
export class WorkoutBlockComparisonService {
  constructor(
    private readonly db: DatabaseService,
    private readonly trainingSignals: WorkoutTrainingSignalsService,
  ) {}

  async compare(
    userId: string,
    routineId: string,
    seriesId: string,
    now = new Date(),
  ): Promise<TrainingBlockComparisonResponse> {
    const routine = await this.db.routine.findFirst({
      where: { id: routineId, userId },
      select: {
        id: true,
        name: true,
        scheduleMode: true,
        isCompleted: true,
        createdAt: true,
        restDays: true,
        rotationWeekdays: true,
        days: BASELINE_DAY_WEEKDAYS_SELECT,
        trainingBlocks: PLAN_BLOCKS_SELECT,
        temporaryOverrides: PLAN_OVERRIDES_SELECT,
        user: { select: { timeZone: true } },
      },
    });
    if (!routine) throw new NotFoundException("Routine not found");
    const timeZone = routine.user.timeZone ?? "UTC";
    const today = localClock(now, timeZone).date;
    const blocks = toPlanBlocks(routine.trainingBlocks);
    const periods = comparisonPeriods(blocks, seriesId, today);

    // A day of slack on each side, then every row is placed by its local date.
    const from = new Date(
      `${addCalendarDays(periods.previous.startDate, -1)}T00:00:00.000Z`,
    );
    const to = new Date(
      Math.min(
        now.getTime(),
        new Date(`${periods.current.endDate}T00:00:00.000Z`).getTime() +
          2 * DAY_MS,
      ),
    );
    const [inputs, overrides] = await Promise.all([
      this.trainingSignals.readInputs(userId, from, to, routine.id),
      this.db.scheduleOverride.findMany({
        where: {
          routineId: routine.id,
          OR: [
            {
              date: {
                gte: periods.previous.startDate,
                lte: periods.current.endDate,
              },
            },
            {
              toDate: {
                gte: periods.previous.startDate,
                lte: periods.current.endDate,
              },
            },
          ],
        },
        select: { routineId: true, kind: true, date: true, toDate: true },
      }),
    ]);
    const planRoutine: ReminderRoutine = {
      ...routine,
      scheduleMode: routine.scheduleMode as "WEEKLY" | "ROTATION",
      trainingBlocks: blocks,
      temporaryOverrides: toPlanOverrides(routine.temporaryOverrides),
    };
    const planOverrides = overrides.map((override) => ({
      ...override,
      kind: override.kind as "MOVE" | "SKIP",
    }));
    return buildBlockComparison({
      routineId: routine.id,
      today,
      periods,
      rows: inputs.rows,
      floors: inputs.floors,
      localDateOf: (at) => localClock(at, timeZone).date,
      planned: {
        current: countPlannedWorkouts(
          planRoutine,
          planOverrides,
          periods.current,
          today,
        ),
        previous: countPlannedWorkouts(
          planRoutine,
          planOverrides,
          periods.previous,
          today,
        ),
      },
    });
  }
}
