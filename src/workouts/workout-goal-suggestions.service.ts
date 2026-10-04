import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, WorkoutAnalyticsProjection } from "@prisma/client";
import {
  apiError,
  DEFAULT_WEEK_STARTS_ON,
  type DismissGoalSuggestionRequest,
  GOAL_SUGGESTION_DISMISSALS_MAX,
  GOAL_SUGGESTION_LIFT_MIN_SESSIONS,
  GOAL_SUGGESTION_LIFT_WINDOW_DAYS,
  GOAL_SUGGESTION_MIN_ACTIVE_WEEKS,
  GOAL_SUGGESTION_STRENGTH_STEP,
  GOAL_SUGGESTION_VOLUME_WEEKS,
  GOAL_SUGGESTIONS_MAX,
  type GoalSuggestion,
  goalSuggestionKey,
  type GoalSuggestionsResponse,
  isGoalSuggestionKey,
  isWeekStartsOn,
  MEASURABLE_GOALS_MAX,
  type MeasurableGoalType,
  weekStartOf,
  type WeightUnit,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { isAcceptableTarget } from "../goals/measurable-goals.service";
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
import { addCalendarDays } from "../schedule/schedule-overrides";
import { localDate } from "./analytics/analytics-contribution";
import { WorkoutProgressQueryDto } from "./dto/workout-progress.dto";

const DAY_MS = 86_400_000;
const POUNDS_PER_KILOGRAM = 2.2046226218;
/** Two suggested numbers closer than this are the same number. */
const SAME_TARGET = 0.005;

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const toKilograms = (value: number, unit: WeightUnit) =>
  unit === "LB" ? roundTo(value / POUNDS_PER_KILOGRAM, 6) : value;
const fromKilograms = (kg: number, unit: WeightUnit) =>
  unit === "LB" ? kg * POUNDS_PER_KILOGRAM : kg;

/**
 * ACH-06: workouts the member's routines plan in one week, by the same rule
 * reminders use -- moves, skips, rest days, blocks and deloads included. A
 * rotation without training weekdays has no dates, so it plans none.
 */
export function plannedWorkoutsInWeek(
  routines: ReminderRoutine[],
  overrides: ReminderOverride[],
  weekStart: string,
): number {
  let planned = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    planned += routinesPlannedOn({
      date: addCalendarDays(weekStart, offset),
      routines,
      overrides,
      routineIdsTrainedOnDate: [],
    }).length;
  }
  return planned;
}

/**
 * The average volume of the complete weeks before the current one, every
 * week counted -- an idle week lowers it -- and the number of weeks that had
 * any volume at all.
 */
export function recentWeeklyVolume(
  dayRows: readonly { date: string; volumeKg: number }[],
  currentWeekStart: string,
  weekStartsOn: number,
  weeks = GOAL_SUGGESTION_VOLUME_WEEKS,
): { averageVolumeKg: number; activeWeeks: number } {
  const first = addCalendarDays(currentWeekStart, -7 * weeks);
  const totals = new Map<string, number>();
  for (const row of dayRows) {
    if (row.date < first || row.date >= currentWeekStart) continue;
    const week = weekStartOf(row.date, isWeekStartsOn(weekStartsOn) ? weekStartsOn : DEFAULT_WEEK_STARTS_ON);
    totals.set(week, (totals.get(week) ?? 0) + row.volumeKg);
  }
  const values = [...totals.values()];
  return {
    averageVolumeKg: values.reduce((sum, value) => sum + value, 0) / weeks,
    activeWeeks: values.filter((value) => value > 0).length,
  };
}

/** A weekly volume target: the nearest hundred in the member's unit. */
export function volumeTarget(averageKg: number, unit: WeightUnit): number {
  const shown = Math.max(100, Math.round(fromKilograms(averageKg, unit) / 100) * 100);
  return toKilograms(shown, unit);
}

/**
 * The next estimated-1RM step: the best plus GOAL_SUGGESTION_STRENGTH_STEP,
 * rounded up to 2.5 kg or 5 lb so it reads as a load, and always above the
 * best.
 */
export function strengthTarget(bestKg: number, unit: WeightUnit): number {
  const step = unit === "LB" ? 5 : 2.5;
  const best = fromKilograms(bestKg, unit);
  let shown = Math.ceil((best * (1 + GOAL_SUGGESTION_STRENGTH_STEP)) / step - 1e-9) * step;
  if (shown <= best + 1e-9) shown += step;
  return toKilograms(shown, unit);
}

/**
 * The lift trained in the most finished workouts of the window, among those
 * with a stored best and at least the minimum workouts; on a tie the one
 * trained most recently, then by name.
 */
export function chooseSuggestedLift<
  L extends {
    exerciseId: string;
    name: string;
    sessions: number;
    lastEndedAt: Date;
    bestEstimated1rmKg: number | null;
  },
>(lifts: readonly L[]): L | null {
  let best: L | null = null;
  for (const lift of lifts) {
    if (lift.bestEstimated1rmKg === null || lift.bestEstimated1rmKg <= 0) continue;
    if (lift.sessions < GOAL_SUGGESTION_LIFT_MIN_SESSIONS) continue;
    if (
      !best ||
      lift.sessions > best.sessions ||
      (lift.sessions === best.sessions &&
        (lift.lastEndedAt.getTime() > best.lastEndedAt.getTime() ||
          (lift.lastEndedAt.getTime() === best.lastEndedAt.getTime() &&
            lift.name.localeCompare(best.name) < 0)))
    ) {
      best = lift;
    }
  }
  return best;
}

/**
 * The candidates in their fixed order, without a type the member already has,
 * without one set aside at the same number, never one the goals write would
 * refuse (implausible logged data can produce one), and no more than the free
 * slots.
 */
export function selectGoalSuggestions(
  candidates: readonly GoalSuggestion[],
  existingTypes: ReadonlySet<MeasurableGoalType>,
  dismissals: readonly { key: string; targetValue: number }[],
  freeSlots: number,
): GoalSuggestion[] {
  return candidates
    .filter((candidate) => !existingTypes.has(candidate.type))
    .filter((candidate) => isAcceptableTarget(candidate.type, candidate.targetValue))
    .filter(
      (candidate) =>
        !dismissals.some(
          (dismissal) =>
            dismissal.key === candidate.key &&
            Math.abs(dismissal.targetValue - candidate.targetValue) < SAME_TARGET,
        ),
    )
    .slice(0, Math.max(0, Math.min(GOAL_SUGGESTIONS_MAX, freeSlots)));
}

@Injectable()
export class WorkoutGoalSuggestionsService {
  constructor(private readonly db: DatabaseService) {}

  async getGoalSuggestions(
    userId: string,
    query: WorkoutProgressQueryDto,
    now = new Date(),
  ): Promise<GoalSuggestionsResponse> {
    const today = localDate(now, query.timeZone);
    const [[projection], user, goals, dismissals] = await Promise.all([
      this.db.$queryRaw<WorkoutAnalyticsProjection[]>`
        SELECT * FROM "WorkoutAnalyticsProjection"
        WHERE "userId" = ${userId} AND "active" AND "state" = 'READY'
          AND "timeZone" = ${query.timeZone}
        LIMIT 1`,
      this.db.user.findUnique({
        where: { id: userId },
        select: { weightUnit: true, weekStartsOn: true },
      }),
      this.db.measurableGoal.findMany({
        where: { userId },
        select: { type: true },
      }),
      this.db.goalSuggestionDismissal.findMany({
        where: { userId },
        select: { key: true, targetValue: true },
      }),
    ]);
    if (!projection) {
      throw new ServiceUnavailableException(apiError("ANALYTICS_NOT_READY"));
    }
    const freeSlots = Math.max(0, MEASURABLE_GOALS_MAX - goals.length);
    const respond = (suggestions: GoalSuggestion[]): GoalSuggestionsResponse => ({
      timeZone: query.timeZone,
      asOf: now.toISOString(),
      freeSlots,
      suggestions,
    });
    const existingTypes = new Set(goals.map((goal) => goal.type as MeasurableGoalType));
    if (freeSlots === 0) return respond([]);

    const unit = (user?.weightUnit ?? "KG") as WeightUnit;
    const weekStartsOn = isWeekStartsOn(user?.weekStartsOn)
      ? user.weekStartsOn
      : DEFAULT_WEEK_STARTS_ON;
    const weekStart = weekStartOf(today, weekStartsOn);
    const candidates: GoalSuggestion[] = [];

    if (!existingTypes.has("WEEKLY_SESSIONS")) {
      const weekEnd = addCalendarDays(weekStart, 6);
      const [routines, overrides] = await Promise.all([
        this.db.routine.findMany({
          where: { userId, isCompleted: false },
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
          },
        }),
        this.db.scheduleOverride.findMany({
          where: {
            routine: { userId },
            OR: [
              { date: { gte: weekStart, lte: weekEnd } },
              { toDate: { gte: weekStart, lte: weekEnd } },
            ],
          },
          select: { routineId: true, kind: true, date: true, toDate: true },
        }),
      ]);
      const planned = plannedWorkoutsInWeek(
        routines.map((routine) => ({
          ...routine,
          scheduleMode: routine.scheduleMode as "WEEKLY" | "ROTATION",
          trainingBlocks: toPlanBlocks(routine.trainingBlocks),
          temporaryOverrides: toPlanOverrides(routine.temporaryOverrides),
        })),
        overrides.map((override) => ({
          ...override,
          kind: override.kind as "MOVE" | "SKIP",
        })),
        weekStart,
      );
      if (planned > 0) {
        candidates.push({
          key: goalSuggestionKey("WEEKLY_SESSIONS"),
          type: "WEEKLY_SESSIONS",
          targetValue: Math.min(14, planned),
          direction: "AT_LEAST",
          exercise: null,
          basis: { kind: "PLAN", plannedWorkouts: planned, weekStart },
        });
      }
    }

    if (!existingTypes.has("WEEKLY_VOLUME")) {
      const rows = await this.db.workoutRollup.findMany({
        where: {
          projectionId: projection.id,
          period: "DAY",
          date: {
            gte: addCalendarDays(weekStart, -7 * GOAL_SUGGESTION_VOLUME_WEEKS),
            lt: weekStart,
          },
        },
        select: { date: true, volumeKg: true },
      });
      const recent = recentWeeklyVolume(rows, weekStart, weekStartsOn);
      if (
        recent.activeWeeks >= GOAL_SUGGESTION_MIN_ACTIVE_WEEKS &&
        recent.averageVolumeKg > 0
      ) {
        candidates.push({
          key: goalSuggestionKey("WEEKLY_VOLUME"),
          type: "WEEKLY_VOLUME",
          targetValue: volumeTarget(recent.averageVolumeKg, unit),
          direction: "AT_LEAST",
          exercise: null,
          basis: {
            kind: "RECENT_VOLUME",
            averageVolumeKg: roundTo(recent.averageVolumeKg, 2),
            weeks: GOAL_SUGGESTION_VOLUME_WEEKS,
            activeWeeks: recent.activeWeeks,
          },
        });
      }
    }

    if (!existingTypes.has("EXERCISE_ESTIMATED_1RM")) {
      const since = new Date(now.getTime() - GOAL_SUGGESTION_LIFT_WINDOW_DAYS * DAY_MS);
      // Loaded working sets of finished workouts: a warm-up never counts.
      const trained = await this.db.$queryRaw<
        Array<{ exerciseId: string; sessions: number; lastEndedAt: Date }>
      >(Prisma.sql`
        SELECT sl."exerciseId", count(DISTINCT sl."sessionId")::int AS "sessions",
               max(s."endedAt") AS "lastEndedAt"
        FROM "SetLog" sl
        JOIN "WorkoutSession" s ON s."id" = sl."sessionId"
        WHERE s."userId" = ${userId} AND s."status" = 'COMPLETED'
          AND s."endedAt" >= ${since} AND sl."isCompleted"
          AND sl."weight" > 0 AND sl."kind" <> 'WARMUP'
        GROUP BY sl."exerciseId"
        ORDER BY "sessions" DESC
        LIMIT 20`);
      const ids = trained
        .filter((row) => row.sessions >= GOAL_SUGGESTION_LIFT_MIN_SESSIONS)
        .map((row) => row.exerciseId);
      if (ids.length) {
        const [records, exercises] = await Promise.all([
          this.db.personalRecord.findMany({
            where: { userId, exerciseId: { in: ids } },
            select: { exerciseId: true, estimated1rm: true },
          }),
          this.db.exercise.findMany({
            where: { id: { in: ids }, archivedAt: null },
            select: { id: true, name: true },
          }),
        ]);
        const best = new Map(records.map((record) => [record.exerciseId, record.estimated1rm]));
        const names = new Map(exercises.map((exercise) => [exercise.id, exercise.name]));
        // A lift whose next step the goals write would refuse is passed over
        // for the next most-trained one.
        const lift = chooseSuggestedLift(
          trained.flatMap((row) =>
            names.has(row.exerciseId) &&
            isAcceptableTarget(
              "EXERCISE_ESTIMATED_1RM",
              strengthTarget(best.get(row.exerciseId) ?? 0, unit),
            )
              ? [
                  {
                    exerciseId: row.exerciseId,
                    name: names.get(row.exerciseId)!,
                    sessions: row.sessions,
                    lastEndedAt: new Date(row.lastEndedAt),
                    bestEstimated1rmKg: best.get(row.exerciseId) ?? null,
                  },
                ]
              : [],
          ),
        );
        if (lift && lift.bestEstimated1rmKg !== null) {
          candidates.push({
            key: goalSuggestionKey("EXERCISE_ESTIMATED_1RM", lift.exerciseId),
            type: "EXERCISE_ESTIMATED_1RM",
            targetValue: strengthTarget(lift.bestEstimated1rmKg, unit),
            direction: "AT_LEAST",
            exercise: { id: lift.exerciseId, name: lift.name },
            basis: {
              kind: "BEST_ESTIMATED_1RM",
              bestEstimated1rmKg: roundTo(lift.bestEstimated1rmKg, 2),
              sessions: lift.sessions,
              windowDays: GOAL_SUGGESTION_LIFT_WINDOW_DAYS,
            },
          });
        }
      }
    }

    return respond(
      selectGoalSuggestions(candidates, existingTypes, dismissals, freeSlots),
    );
  }

  /**
   * "Not now": the suggestion stays hidden while it would suggest this same
   * number. The newest GOAL_SUGGESTION_DISMISSALS_MAX are kept.
   */
  async dismiss(
    userId: string,
    request: DismissGoalSuggestionRequest,
  ): Promise<{ key: string; targetValue: number }> {
    if (!isGoalSuggestionKey(request.key)) {
      throw new BadRequestException("Unknown goal suggestion");
    }
    if (!Number.isFinite(request.targetValue) || request.targetValue <= 0) {
      throw new BadRequestException("Invalid suggested target");
    }
    await this.db.$transaction(async (tx) => {
      await tx.goalSuggestionDismissal.upsert({
        where: { userId_key: { userId, key: request.key } },
        create: { userId, key: request.key, targetValue: request.targetValue },
        update: { targetValue: request.targetValue, dismissedAt: new Date() },
      });
      const stale = await tx.goalSuggestionDismissal.findMany({
        where: { userId },
        orderBy: [{ dismissedAt: "desc" }, { key: "asc" }],
        skip: GOAL_SUGGESTION_DISMISSALS_MAX,
        select: { key: true },
      });
      if (stale.length) {
        await tx.goalSuggestionDismissal.deleteMany({
          where: { userId, key: { in: stale.map((row) => row.key) } },
        });
      }
    });
    return { key: request.key, targetValue: request.targetValue };
  }
}
