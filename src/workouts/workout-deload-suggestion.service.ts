import { Injectable } from "@nestjs/common";
import {
  DELOAD_DEFAULT_DAYS,
  DELOAD_DEFAULT_LOAD_REDUCTION,
  DELOAD_DEFAULT_SET_MODE,
  DELOAD_SUGGESTION_COOLDOWN_DAYS,
  DELOAD_SUGGESTION_EARLIER_DAYS,
  DELOAD_SUGGESTION_MIN_MARKED_TODAY,
  DELOAD_SUGGESTION_ROUTINE_DAYS,
  DELOAD_SUGGESTION_SIGNALS,
  type DeloadSuggestionEvidence,
  type DeloadSuggestionResponse,
  type DeloadSuggestionSignal,
  type DeloadSuggestionUnavailableReason,
  resolveActiveTrainingBlock,
  resolveRoutinePlan,
  TRAINING_SIGNAL_PERIOD_DAYS,
  type TrainingSignalsResponse,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { localClock } from "../notifications/push/local-time";
import { routinesPlannedOn } from "../notifications/push/training-days";
import {
  BASELINE_DAY_WEEKDAYS_SELECT,
  PLAN_BLOCKS_SELECT,
  PLAN_OVERRIDES_SELECT,
  toPlanBlocks,
  toPlanOverrides,
} from "../routines/routine-plan";
import { addCalendarDays } from "../schedule/schedule-overrides";
import {
  evaluateTrainingSignals,
  WorkoutTrainingSignalsService,
} from "./workout-training-signals.service";

const DAY_MS = 86_400_000;

const markedFor = (
  signals: TrainingSignalsResponse,
  signal: DeloadSuggestionSignal,
): boolean =>
  signal === "EFFORT"
    ? signals.effort.marked
    : signal === "REP_TARGETS"
      ? signals.repTargets.marked
      : signals.declines.marked;

/**
 * INTEL-02: a load signal is sustained when it is marked today and was
 * marked a week ago, or when enough of them are marked today. The workouts
 * signal is never read: training less is not a reason to train lighter.
 */
export function sustainedEvidence(
  current: TrainingSignalsResponse,
  earlier: TrainingSignalsResponse,
): { evidence: DeloadSuggestionEvidence[]; sustained: boolean } {
  const evidence = DELOAD_SUGGESTION_SIGNALS.map((signal) => ({
    signal,
    markedNow: markedFor(current, signal),
    markedEarlier: markedFor(earlier, signal),
  }));
  const markedNow = evidence.filter((entry) => entry.markedNow);
  return {
    evidence,
    sustained:
      markedNow.some((entry) => entry.markedEarlier) ||
      markedNow.length >= DELOAD_SUGGESTION_MIN_MARKED_TODAY,
  };
}

/**
 * A deload already in force or planned on any routine rules a suggestion
 * out, and so does one that ended within the cooldown.
 */
export function deloadStateReason(
  deloads: readonly { startDate: string; endDate: string }[],
  today: string,
): DeloadSuggestionUnavailableReason | null {
  if (deloads.some((deload) => deload.endDate >= today)) {
    return "DELOAD_SCHEDULED";
  }
  const cooldownStart = addCalendarDays(
    today,
    -DELOAD_SUGGESTION_COOLDOWN_DAYS,
  );
  return deloads.some((deload) => deload.endDate >= cooldownStart)
    ? "RECENT_DELOAD"
    : null;
}

/**
 * The active routine with the most workouts in the routine window; on a tie,
 * the one trained most recently.
 */
export function chooseSuggestionRoutine<
  R extends { id: string; isCompleted: boolean },
>(
  routines: readonly R[],
  workouts: readonly {
    sessionId: string;
    routineId?: string | null;
    endedAt: Date;
  }[],
  now: Date,
): R | null {
  const since = now.getTime() - DELOAD_SUGGESTION_ROUTINE_DAYS * DAY_MS;
  const byRoutine = new Map<string, { sessions: Set<string>; last: number }>();
  for (const workout of workouts) {
    const time = workout.endedAt.getTime();
    if (!workout.routineId || time <= since || time > now.getTime()) continue;
    const entry = byRoutine.get(workout.routineId) ?? {
      sessions: new Set<string>(),
      last: 0,
    };
    entry.sessions.add(workout.sessionId);
    entry.last = Math.max(entry.last, time);
    byRoutine.set(workout.routineId, entry);
  }
  let best: { routine: R; count: number; last: number } | null = null;
  for (const routine of routines) {
    const entry = byRoutine.get(routine.id);
    if (routine.isCompleted || !entry) continue;
    const count = entry.sessions.size;
    if (
      !best ||
      count > best.count ||
      (count === best.count && entry.last > best.last)
    ) {
      best = { routine, count, last: entry.last };
    }
  }
  return best?.routine ?? null;
}

/**
 * Today, or tomorrow when the routine was already trained today, for the
 * ROUT-16 default length -- cut short where a training block starts or ends,
 * because a deload stays inside one plan.
 */
export function suggestionWindow(
  today: string,
  trainedToday: boolean,
  blocks: readonly {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
  }[],
): {
  startDate: string;
  endDate: string;
  lengthDays: number;
  blockName: string | null;
} {
  const startDate = trainedToday ? addCalendarDays(today, 1) : today;
  const block = resolveActiveTrainingBlock(blocks, startDate);
  let endDate = startDate;
  let lengthDays = 1;
  while (lengthDays < DELOAD_DEFAULT_DAYS) {
    const next = addCalendarDays(endDate, 1);
    if (resolveActiveTrainingBlock(blocks, next)?.id !== block?.id) break;
    endDate = next;
    lengthDays += 1;
  }
  return { startDate, endDate, lengthDays, blockName: block?.name ?? null };
}

/**
 * Reads the PROG-10 inputs over both evaluations' windows, the owner's
 * routines with their plans and deloads, and today's workouts and schedule
 * overrides -- all bounded -- then applies the pure rules above.
 */
@Injectable()
export class WorkoutDeloadSuggestionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly trainingSignals: WorkoutTrainingSignalsService,
  ) {}

  async getDeloadSuggestion(
    userId: string,
    now = new Date(),
    // Injectable so the orchestration is tested apart from the PROG-10 rules.
    evaluate: typeof evaluateTrainingSignals = evaluateTrainingSignals,
  ): Promise<DeloadSuggestionResponse> {
    const earlierAt = new Date(
      now.getTime() - DELOAD_SUGGESTION_EARLIER_DAYS * DAY_MS,
    );
    const windowStart = new Date(
      earlierAt.getTime() - 2 * TRAINING_SIGNAL_PERIOD_DAYS * DAY_MS,
    );
    const [user, inputs] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        select: { timeZone: true },
      }),
      this.trainingSignals.readInputs(userId, windowStart, now),
    ]);
    const timeZone = user?.timeZone ?? "UTC";
    const today = localClock(now, timeZone).date;
    const { evidence, sustained } = sustainedEvidence(
      evaluate(inputs.rows, inputs.floors, now),
      evaluate(inputs.rows, inputs.floors, earlierAt),
    );
    const respond = (
      unavailable: DeloadSuggestionUnavailableReason | null,
      suggestion: DeloadSuggestionResponse["suggestion"] = null,
    ): DeloadSuggestionResponse => ({
      asOf: now.toISOString(),
      thresholds: {
        earlierDays: DELOAD_SUGGESTION_EARLIER_DAYS,
        minMarkedToday: DELOAD_SUGGESTION_MIN_MARKED_TODAY,
        cooldownDays: DELOAD_SUGGESTION_COOLDOWN_DAYS,
        routineDays: DELOAD_SUGGESTION_ROUTINE_DAYS,
        lengthDays: DELOAD_DEFAULT_DAYS,
      },
      evidence,
      suggestion,
      unavailable,
    });
    if (!sustained) return respond("NOT_SUSTAINED");

    const [deloads, routines] = await Promise.all([
      this.db.routineTemporaryOverride.findMany({
        where: {
          routine: { userId },
          endDate: {
            gte: addCalendarDays(today, -DELOAD_SUGGESTION_COOLDOWN_DAYS),
          },
        },
        select: { startDate: true, endDate: true },
      }),
      this.db.routine.findMany({
        where: { userId },
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
    ]);
    const deloadReason = deloadStateReason(deloads, today);
    if (deloadReason) return respond(deloadReason);

    const routine = chooseSuggestionRoutine(routines, inputs.rows, now);
    if (!routine) return respond("NO_ROUTINE");

    const recent = await this.db.workoutSession.findMany({
      where: {
        userId,
        routineId: routine.id,
        startedAt: { gte: new Date(now.getTime() - 2 * DAY_MS) },
      },
      select: { startedAt: true },
    });
    const trainedToday = recent.some(
      (session) => localClock(session.startedAt, timeZone).date === today,
    );
    const blocks = toPlanBlocks(routine.trainingBlocks);
    const window = suggestionWindow(today, trainedToday, blocks);

    const overrides = await this.db.scheduleOverride.findMany({
      where: {
        routineId: routine.id,
        OR: [
          { date: { gte: window.startDate, lte: window.endDate } },
          { toDate: { gte: window.startDate, lte: window.endDate } },
        ],
      },
      select: { routineId: true, kind: true, date: true, toDate: true },
    });
    const planRoutine = {
      ...routine,
      scheduleMode: routine.scheduleMode as "WEEKLY" | "ROTATION",
      trainingBlocks: blocks,
      temporaryOverrides: toPlanOverrides(routine.temporaryOverrides),
    };
    let planned = false;
    for (
      let date = window.startDate;
      date <= window.endDate;
      date = addCalendarDays(date, 1)
    ) {
      // A rotation without training weekdays can be trained on any date.
      const plan = resolveRoutinePlan(planRoutine, date);
      const undated =
        plan.scheduleMode === "ROTATION" && plan.rotationWeekdays.length === 0;
      if (
        undated ||
        routinesPlannedOn({
          date,
          routines: [planRoutine],
          overrides: overrides.map((o) => ({
            ...o,
            kind: o.kind as "MOVE" | "SKIP",
          })),
          routineIdsTrainedOnDate: [],
        }).length > 0
      ) {
        planned = true;
        break;
      }
    }
    if (!planned) return respond("NOTHING_PLANNED");

    return respond(null, {
      routineId: routine.id,
      routineName: routine.name,
      startDate: window.startDate,
      endDate: window.endDate,
      lengthDays: window.lengthDays,
      loadReductionPercent: DELOAD_DEFAULT_LOAD_REDUCTION,
      setMode: DELOAD_DEFAULT_SET_MODE,
      trainingBlockName: window.blockName,
    });
  }
}
