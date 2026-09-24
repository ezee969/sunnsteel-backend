import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type DecliningLift,
  type DecliningLiftSession,
  type RepTargetPeriod,
  TRAINING_SIGNAL_DECLINE_SESSIONS,
  TRAINING_SIGNAL_DECLINES_MAX,
  TRAINING_SIGNAL_MIN_DECLINE,
  TRAINING_SIGNAL_MIN_RPE_SETS,
  TRAINING_SIGNAL_MIN_SHORT_SETS,
  TRAINING_SIGNAL_MIN_TARGET_SETS,
  TRAINING_SIGNAL_PERIOD_DAYS,
  TRAINING_SIGNAL_RPE_RISE,
  TRAINING_SIGNAL_SHORT_LIFTS_MAX,
  TRAINING_SIGNAL_SHORT_POINTS_RISE,
  TRAINING_SIGNAL_WORKOUT_DROP,
  type TrainingSignalsResponse,
  type WorkoutPeriod,
  type WorkoutSessionSnapshotV1,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { recordValues } from "./live-personal-records";

const DAY_MS = 86_400_000;
const EPSILON = 1e-9;

/** One completed set of a finished or ended-early workout in the window. */
export interface TrainingSignalSetRow {
  sessionId: string;
  /** The routine the workout trained; null once that routine is deleted. */
  routineId?: string | null;
  status: "COMPLETED" | "ABORTED";
  endedAt: Date;
  /** ROUT-16: the workout trained a deload. */
  isDeload: boolean;
  exerciseId: string;
  exerciseName: string;
  /** The snapshot slot the set was logged against. */
  slotId: string | null;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
}

/** Rep-target floors per session, keyed by `slotId:setNumber`. */
export type RepTargetFloors = ReadonlyMap<string, ReadonlyMap<string, number>>;

type Half = "recent" | "previous";

const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const estimated1rm = (weight: number, reps: number) =>
  recordValues({ isCompleted: true, weight, reps }).ESTIMATED_1RM ?? 0;
const floorKey = (slotId: string, setNumber: number) =>
  `${slotId}:${setNumber}`;

/**
 * The lowest reps each prescribed set asks for, from the workout's own
 * snapshot: a fixed target's reps, a range's minimum. A set with neither
 * has no target and is never counted against one.
 */
export function repTargetFloors(
  snapshot: Pick<WorkoutSessionSnapshotV1, "routineDay">,
): Map<string, number> {
  const floors = new Map<string, number>();
  for (const exercise of snapshot.routineDay.exercises) {
    for (const set of exercise.sets) {
      const floor = set.repType === "RANGE" ? set.minReps : set.reps;
      if (typeof floor === "number" && floor > 0) {
        floors.set(floorKey(exercise.id, set.setNumber), floor);
      }
    }
  }
  return floors;
}

/**
 * PROG-10: the four training signals, pure so every threshold is tested
 * without a database. Each states numbers only; `marked` means a stated
 * threshold was crossed, never a conclusion about why.
 */
export function evaluateTrainingSignals(
  rows: readonly TrainingSignalSetRow[],
  floors: RepTargetFloors,
  now: Date,
): TrainingSignalsResponse {
  const periodMs = TRAINING_SIGNAL_PERIOD_DAYS * DAY_MS;
  const recentFrom = now.getTime() - periodMs;
  const previousFrom = recentFrom - periodMs;
  const halfOf = (endedAt: Date): Half | null => {
    const time = endedAt.getTime();
    if (time > now.getTime() || time <= previousFrom) return null;
    return time > recentFrom ? "recent" : "previous";
  };
  const inWindow = rows.filter((row) => halfOf(row.endedAt) !== null);
  const trained = inWindow.filter((row) => !row.isDeload);

  return {
    asOf: now.toISOString(),
    periods: {
      recent: {
        from: new Date(recentFrom).toISOString(),
        to: now.toISOString(),
      },
      previous: {
        from: new Date(previousFrom).toISOString(),
        to: new Date(recentFrom).toISOString(),
      },
    },
    thresholds: {
      periodDays: TRAINING_SIGNAL_PERIOD_DAYS,
      minRpeSets: TRAINING_SIGNAL_MIN_RPE_SETS,
      rpeRise: TRAINING_SIGNAL_RPE_RISE,
      minTargetSets: TRAINING_SIGNAL_MIN_TARGET_SETS,
      shortPointsRise: TRAINING_SIGNAL_SHORT_POINTS_RISE,
      minShortSets: TRAINING_SIGNAL_MIN_SHORT_SETS,
      declineSessions: TRAINING_SIGNAL_DECLINE_SESSIONS,
      minDecline: TRAINING_SIGNAL_MIN_DECLINE,
      workoutDrop: TRAINING_SIGNAL_WORKOUT_DROP,
    },
    effort: effortSignal(trained, halfOf),
    repTargets: repTargetSignal(trained, floors, halfOf),
    declines: declineSignal(trained),
    workouts: workoutSignal(inWindow, halfOf),
  };
}

function effortSignal(
  rows: readonly TrainingSignalSetRow[],
  halfOf: (endedAt: Date) => Half | null,
): TrainingSignalsResponse["effort"] {
  const rated = rows.filter((row) => row.rpe !== null);
  const liftsIn = (half: Half) =>
    new Set(
      rated
        .filter((row) => halfOf(row.endedAt) === half)
        .map((row) => row.exerciseId),
    );
  const recentLifts = liftsIn("recent");
  const previousLifts = liftsIn("previous");
  const shared = [...recentLifts].filter((id) => previousLifts.has(id));
  const sharedSet = new Set(shared);
  const values = (half: Half) =>
    rated
      .filter(
        (row) => halfOf(row.endedAt) === half && sharedSet.has(row.exerciseId),
      )
      .map((row) => row.rpe as number);
  const recent = values("recent");
  const previous = values("previous");
  const enough =
    recent.length >= TRAINING_SIGNAL_MIN_RPE_SETS &&
    previous.length >= TRAINING_SIGNAL_MIN_RPE_SETS;
  const average = (list: number[]) =>
    round1(list.reduce((sum, value) => sum + value, 0) / list.length);

  if (!enough) {
    return {
      comparison: null,
      recentSets: recent.length,
      previousSets: previous.length,
      marked: false,
    };
  }
  const recentAverage = average(recent);
  const previousAverage = average(previous);
  const difference = round1(recentAverage - previousAverage);
  return {
    comparison: {
      recent: { averageRpe: recentAverage, sets: recent.length },
      previous: { averageRpe: previousAverage, sets: previous.length },
      difference,
      lifts: shared.length,
    },
    recentSets: recent.length,
    previousSets: previous.length,
    marked: difference >= TRAINING_SIGNAL_RPE_RISE - EPSILON,
  };
}

function repTargetSignal(
  rows: readonly TrainingSignalSetRow[],
  floors: RepTargetFloors,
  halfOf: (endedAt: Date) => Half | null,
): TrainingSignalsResponse["repTargets"] {
  const periods: Record<Half, { short: number; targeted: number }> = {
    recent: { short: 0, targeted: 0 },
    previous: { short: 0, targeted: 0 },
  };
  const shortLifts = new Map<
    string,
    { exerciseId: string; exerciseName: string; shortSets: number }
  >();
  for (const row of rows) {
    if (row.slotId === null || row.reps === null) continue;
    const floor = floors
      .get(row.sessionId)
      ?.get(floorKey(row.slotId, row.setNumber));
    if (floor === undefined) continue;
    const half = halfOf(row.endedAt) as Half;
    periods[half].targeted += 1;
    if (row.reps >= floor) continue;
    periods[half].short += 1;
    if (half !== "recent") continue;
    const lift = shortLifts.get(row.exerciseId) ?? {
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      shortSets: 0,
    };
    lift.shortSets += 1;
    shortLifts.set(row.exerciseId, lift);
  }

  const period = (half: Half): RepTargetPeriod => ({
    shortSets: periods[half].short,
    targetedSets: periods[half].targeted,
    shortPercent:
      periods[half].targeted > 0
        ? Math.round((periods[half].short / periods[half].targeted) * 100)
        : 0,
  });
  const recent = period("recent");
  const previous = period("previous");
  const comparable =
    recent.targetedSets >= TRAINING_SIGNAL_MIN_TARGET_SETS &&
    previous.targetedSets >= TRAINING_SIGNAL_MIN_TARGET_SETS;
  return {
    recent,
    previous,
    comparable,
    mostOften: [...shortLifts.values()]
      .sort(
        (a, b) =>
          b.shortSets - a.shortSets ||
          a.exerciseName.localeCompare(b.exerciseName),
      )
      .slice(0, TRAINING_SIGNAL_SHORT_LIFTS_MAX),
    marked:
      comparable &&
      recent.shortSets >= TRAINING_SIGNAL_MIN_SHORT_SETS &&
      recent.shortPercent - previous.shortPercent >=
        TRAINING_SIGNAL_SHORT_POINTS_RISE,
  };
}

function declineSignal(
  rows: readonly TrainingSignalSetRow[],
): TrainingSignalsResponse["declines"] {
  const byLift = new Map<
    string,
    { exerciseName: string; sessions: Map<string, DecliningLiftSession> }
  >();
  for (const row of rows) {
    if (!row.weight || row.weight <= 0 || !row.reps || row.reps <= 0) continue;
    const value = estimated1rm(row.weight, row.reps);
    const lift = byLift.get(row.exerciseId) ?? {
      exerciseName: row.exerciseName,
      sessions: new Map<string, DecliningLiftSession>(),
    };
    const best = lift.sessions.get(row.sessionId);
    if (
      !best ||
      value > best.estimated1rmKg ||
      (value === best.estimated1rmKg && row.weight > best.weightKg)
    ) {
      lift.sessions.set(row.sessionId, {
        sessionId: row.sessionId,
        performedAt: row.endedAt.toISOString(),
        estimated1rmKg: value,
        weightKg: row.weight,
        reps: row.reps,
      });
    }
    byLift.set(row.exerciseId, lift);
  }

  let checkedLifts = 0;
  const lifts: DecliningLift[] = [];
  for (const [exerciseId, lift] of byLift) {
    const sessions = [...lift.sessions.values()]
      .sort((a, b) => a.performedAt.localeCompare(b.performedAt))
      .slice(-TRAINING_SIGNAL_DECLINE_SESSIONS);
    if (sessions.length < TRAINING_SIGNAL_DECLINE_SESSIONS) continue;
    checkedLifts += 1;
    const fellEachTime = sessions.every(
      (session, index) =>
        index === 0 ||
        session.estimated1rmKg < sessions[index - 1].estimated1rmKg,
    );
    if (!fellEachTime) continue;
    const first = sessions[0].estimated1rmKg;
    const last = sessions[sessions.length - 1].estimated1rmKg;
    const declineRatio = round3((first - last) / first);
    if (declineRatio < TRAINING_SIGNAL_MIN_DECLINE - EPSILON) continue;
    lifts.push({
      exerciseId,
      exerciseName: lift.exerciseName,
      sessions,
      declineRatio,
    });
  }
  lifts.sort(
    (a, b) =>
      b.declineRatio - a.declineRatio ||
      a.exerciseName.localeCompare(b.exerciseName),
  );
  const listed = lifts.slice(0, TRAINING_SIGNAL_DECLINES_MAX);
  return { checkedLifts, lifts: listed, marked: listed.length > 0 };
}

function workoutSignal(
  rows: readonly TrainingSignalSetRow[],
  halfOf: (endedAt: Date) => Half | null,
): TrainingSignalsResponse["workouts"] {
  const periods: Record<Half, WorkoutPeriod> = {
    recent: { workouts: 0, endedEarly: 0, deloads: 0 },
    previous: { workouts: 0, endedEarly: 0, deloads: 0 },
  };
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.sessionId)) continue;
    seen.add(row.sessionId);
    const period = periods[halfOf(row.endedAt) as Half];
    period.workouts += 1;
    if (row.status === "ABORTED") period.endedEarly += 1;
    if (row.isDeload) period.deloads += 1;
  }
  const { recent, previous } = periods;
  return {
    recent,
    previous,
    marked:
      previous.workouts - recent.workouts >= TRAINING_SIGNAL_WORKOUT_DROP ||
      recent.endedEarly > previous.endedEarly,
  };
}

/**
 * Reads only the completed sets of the owner's finished and ended-early
 * workouts that ended in the last two periods, plus those workouts'
 * snapshots for their rep targets -- never lifetime set logs. A workout with
 * no completed set is not evidence of anything and is not counted.
 */
@Injectable()
export class WorkoutTrainingSignalsService {
  constructor(private readonly db: DatabaseService) {}

  async getTrainingSignals(
    userId: string,
    now = new Date(),
  ): Promise<TrainingSignalsResponse> {
    const { rows, floors } = await this.readInputs(
      userId,
      new Date(now.getTime() - 2 * TRAINING_SIGNAL_PERIOD_DAYS * DAY_MS),
      now,
    );
    return evaluateTrainingSignals(rows, floors, now);
  }

  /**
   * The completed sets of workouts that ended in (from, to], with their
   * snapshots' rep-target floors. INTEL-02 reads a wider window through the
   * same query, so both evaluations see exactly what PROG-10 sees.
   */
  async readInputs(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<{ rows: TrainingSignalSetRow[]; floors: RepTargetFloors }> {
    const rows = await this.db.$queryRaw<TrainingSignalSetRow[]>(Prisma.sql`
      SELECT
        sessions."id" AS "sessionId",
        sessions."routineId",
        sessions."status"::text AS "status",
        sessions."endedAt",
        (sessions."temporaryOverrideId" IS NOT NULL
          OR sessions."temporaryOverrideKind" IS NOT NULL) AS "isDeload",
        logs."exerciseId",
        exercises."name" AS "exerciseName",
        COALESCE(logs."sourceRoutineExerciseId", logs."routineExerciseId") AS "slotId",
        logs."setNumber",
        logs."reps",
        logs."weight",
        logs."rpe"
      FROM "SetLog" logs
      INNER JOIN "WorkoutSession" sessions ON sessions."id" = logs."sessionId"
      INNER JOIN "Exercise" exercises ON exercises."id" = logs."exerciseId"
      WHERE sessions."userId" = ${userId}
        AND sessions."status" IN ('COMPLETED', 'ABORTED')
        AND sessions."endedAt" IS NOT NULL
        AND sessions."endedAt" > ${from}
        AND sessions."endedAt" <= ${to}
        AND logs."isCompleted"`);

    const sessionIds = [...new Set(rows.map((row) => row.sessionId))];
    const snapshots = sessionIds.length
      ? await this.db.workoutSessionSnapshot.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { sessionId: true, payload: true },
        })
      : [];
    const floors = new Map<string, Map<string, number>>();
    for (const snapshot of snapshots) {
      const payload =
        snapshot.payload as unknown as WorkoutSessionSnapshotV1 | null;
      if (!payload?.routineDay?.exercises) continue;
      floors.set(snapshot.sessionId, repTargetFloors(payload));
    }
    return { rows, floors };
  }
}
