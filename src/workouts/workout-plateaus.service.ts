import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type ExercisePlateau,
  PLATEAU_MIN_DAYS_SINCE_BEST,
  PLATEAU_MIN_SESSIONS,
  PLATEAU_RECENT_DAYS,
  PLATEAU_WINDOW_DAYS,
  type PlateausResponse,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { recordValues } from "./live-personal-records";

const DAY_MS = 86_400_000;

/** One completed loaded set inside the window, beside its exercise's best. */
export interface PlateauSetRow {
  exerciseId: string;
  exerciseName: string;
  bestWeight: number;
  bestReps: number;
  bestEstimated1rm: number;
  bestAchievedAt: Date;
  bestSessionId: string;
  sessionId: string;
  weight: number;
  reps: number;
  endedAt: Date;
}

const estimated1rm = (weight: number, reps: number) =>
  recordValues({ isCompleted: true, weight, reps }).ESTIMATED_1RM ?? 0;

/**
 * PROG-09: which recently trained lifts have gone the threshold number of
 * sessions without a new best. Pure, so the rule is tested without a
 * database. A lift whose estimated 1RM rose since its best is never flagged,
 * even when no new best-set record was persisted.
 */
export function evaluatePlateaus(
  rows: readonly PlateauSetRow[],
  now: Date,
): PlateausResponse {
  const windowStart = now.getTime() - PLATEAU_WINDOW_DAYS * DAY_MS;
  const recentStart = now.getTime() - PLATEAU_RECENT_DAYS * DAY_MS;
  const byExercise = new Map<string, PlateauSetRow[]>();
  for (const row of rows) {
    const list = byExercise.get(row.exerciseId) ?? [];
    list.push(row);
    byExercise.set(row.exerciseId, list);
  }

  let checkedExercises = 0;
  const plateaus: ExercisePlateau[] = [];
  for (const sets of byExercise.values()) {
    const [first] = sets;
    const lastPerformedAt = Math.max(
      ...sets.map((set) => set.endedAt.getTime()),
    );
    if (lastPerformedAt < recentStart) continue;
    checkedExercises += 1;

    const bestAt = first.bestAchievedAt.getTime();
    const countedSince = Math.max(bestAt, windowStart);
    const since = sets.filter(
      (set) =>
        set.sessionId !== first.bestSessionId &&
        set.endedAt.getTime() > countedSince,
    );
    const sessions = new Set(since.map((set) => set.sessionId)).size;
    if (
      sessions < PLATEAU_MIN_SESSIONS ||
      now.getTime() - bestAt < PLATEAU_MIN_DAYS_SINCE_BEST * DAY_MS
    ) {
      continue;
    }

    const closest = since.reduce((top, set) => {
      const value = estimated1rm(set.weight, set.reps);
      const topValue = estimated1rm(top.weight, top.reps);
      return value > topValue ||
        (value === topValue && set.endedAt > top.endedAt)
        ? set
        : top;
    });
    const closestEstimate = estimated1rm(closest.weight, closest.reps);
    if (closestEstimate > first.bestEstimated1rm) continue;

    plateaus.push({
      exerciseId: first.exerciseId,
      exerciseName: first.exerciseName,
      best: {
        weightKg: first.bestWeight,
        reps: first.bestReps,
        estimated1rmKg: first.bestEstimated1rm,
        achievedAt: first.bestAchievedAt.toISOString(),
      },
      countedSince: new Date(countedSince).toISOString(),
      sessionsWithoutNewBest: sessions,
      closest: {
        weightKg: closest.weight,
        reps: closest.reps,
        estimated1rmKg: closestEstimate,
        performedAt: closest.endedAt.toISOString(),
      },
      closestRatio:
        first.bestEstimated1rm > 0
          ? Math.round((closestEstimate / first.bestEstimated1rm) * 1000) / 1000
          : 0,
      lastPerformedAt: new Date(lastPerformedAt).toISOString(),
    });
  }

  plateaus.sort(
    (a, b) =>
      b.sessionsWithoutNewBest - a.sessionsWithoutNewBest ||
      a.best.achievedAt.localeCompare(b.best.achievedAt) ||
      a.exerciseName.localeCompare(b.exerciseName),
  );

  return {
    asOf: now.toISOString(),
    thresholds: {
      windowDays: PLATEAU_WINDOW_DAYS,
      minSessions: PLATEAU_MIN_SESSIONS,
      minDaysSinceBest: PLATEAU_MIN_DAYS_SINCE_BEST,
      recentDays: PLATEAU_RECENT_DAYS,
    },
    checkedExercises,
    plateaus,
  };
}

/**
 * Reads only the owner's persisted best per exercise (one row each) and the
 * completed loaded sets of terminal sessions inside the look-back window —
 * never lifetime set logs.
 */
@Injectable()
export class WorkoutPlateausService {
  constructor(private readonly db: DatabaseService) {}

  async getPlateaus(
    userId: string,
    now = new Date(),
  ): Promise<PlateausResponse> {
    const windowStart = new Date(now.getTime() - PLATEAU_WINDOW_DAYS * DAY_MS);
    const rows = await this.db.$queryRaw<PlateauSetRow[]>(Prisma.sql`
      SELECT
        records."exerciseId",
        records."exerciseName",
        records."weight" AS "bestWeight",
        records."reps" AS "bestReps",
        records."estimated1rm" AS "bestEstimated1rm",
        records."achievedAt" AS "bestAchievedAt",
        records."sessionId" AS "bestSessionId",
        logs."sessionId",
        logs."weight",
        logs."reps",
        sessions."endedAt"
      FROM "PersonalRecord" records
      INNER JOIN "SetLog" logs ON logs."exerciseId" = records."exerciseId"
      INNER JOIN "WorkoutSession" sessions ON sessions."id" = logs."sessionId"
      WHERE records."userId" = ${userId}
        AND sessions."userId" = ${userId}
        AND sessions."status" IN ('COMPLETED', 'ABORTED')
        AND sessions."endedAt" IS NOT NULL
        AND sessions."endedAt" >= ${windowStart}
        AND sessions."endedAt" <= ${now}
        AND logs."isCompleted"
        AND logs."reps" > 0
        AND logs."weight" > 0`);
    return evaluatePlateaus(rows, now);
  }
}
