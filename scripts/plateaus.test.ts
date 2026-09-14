import * as assert from "node:assert/strict";
import { test } from "node:test";
import { PLATEAU_MIN_SESSIONS, PLATEAU_WINDOW_DAYS } from "@sunsteel/contracts";
import { DatabaseService } from "../src/database/database.service";
import {
  evaluatePlateaus,
  type PlateauSetRow,
  WorkoutPlateausService,
} from "../src/workouts/workout-plateaus.service";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function lift(
  exerciseId: string,
  best: { weight: number; reps: number; daysAgo: number },
  sessions: Array<{ daysAgo: number; weight: number; reps: number }>,
): PlateauSetRow[] {
  const bestAchievedAt = daysAgo(best.daysAgo);
  return [
    // The session that set the best is never counted against it.
    {
      exerciseId,
      exerciseName: exerciseId,
      bestWeight: best.weight,
      bestReps: best.reps,
      bestEstimated1rm:
        Math.round(best.weight * (1 + best.reps / 30) * 10) / 10,
      bestAchievedAt,
      bestSessionId: `${exerciseId}-best`,
      sessionId: `${exerciseId}-best`,
      weight: best.weight,
      reps: best.reps,
      endedAt: new Date(bestAchievedAt.getTime() + 3_600_000),
    },
    ...sessions.map((session, index) => ({
      exerciseId,
      exerciseName: exerciseId,
      bestWeight: best.weight,
      bestReps: best.reps,
      bestEstimated1rm:
        Math.round(best.weight * (1 + best.reps / 30) * 10) / 10,
      bestAchievedAt,
      bestSessionId: `${exerciseId}-best`,
      sessionId: `${exerciseId}-${index}`,
      weight: session.weight,
      reps: session.reps,
      endedAt: daysAgo(session.daysAgo),
    })),
  ];
}

const repeated = (count: number, weight: number, reps: number, from = 24) =>
  Array.from({ length: count }, (_, index) => ({
    daysAgo: from - index * 5,
    weight,
    reps,
  }));

test("flags a recently trained lift with enough sessions and an old best", () => {
  const result = evaluatePlateaus(
    lift("bench", { weight: 100, reps: 5, daysAgo: 30 }, [
      ...repeated(PLATEAU_MIN_SESSIONS, 97.5, 5),
      { daysAgo: 2, weight: 100, reps: 4 },
    ]),
    NOW,
  );
  assert.equal(result.checkedExercises, 1);
  assert.equal(result.plateaus.length, 1);
  const [plateau] = result.plateaus;
  assert.equal(plateau.sessionsWithoutNewBest, PLATEAU_MIN_SESSIONS + 1);
  assert.equal(plateau.best.estimated1rmKg, 116.7);
  // Closest by estimated 1RM: 97.5 × 5 (113.8) outranks 100 × 4 (113.3).
  assert.deepEqual([plateau.closest.weightKg, plateau.closest.reps], [97.5, 5]);
  assert.equal(plateau.closestRatio, 0.975);
  assert.equal(result.thresholds.windowDays, PLATEAU_WINDOW_DAYS);
});

test("does not flag without enough sessions, with a recent best or when stale", () => {
  const at = (days: number[], weight: number, reps: number) =>
    days.map((day) => ({ daysAgo: day, weight, reps }));
  const few = lift(
    "row",
    { weight: 80, reps: 8, daysAgo: 30 },
    at([24, 19, 14], 77.5, 8),
  );
  const recentBest = lift(
    "press",
    { weight: 50, reps: 6, daysAgo: 10 },
    at([8, 7, 6, 5, 4], 47.5, 6),
  );
  const stale = lift(
    "curl",
    { weight: 20, reps: 10, daysAgo: 50 },
    at([45, 40, 35, 30, 25], 17.5, 10),
  );
  const result = evaluatePlateaus([...few, ...recentBest, ...stale], NOW);
  assert.equal(result.plateaus.length, 0);
  // The curl was last trained 25 days ago, outside the recent days.
  assert.equal(result.checkedExercises, 2);
});

test("never flags a lift whose estimated 1RM rose since its best", () => {
  const result = evaluatePlateaus(
    lift("squat", { weight: 140, reps: 3, daysAgo: 40 }, repeated(5, 120, 10)),
    NOW,
  );
  assert.equal(result.checkedExercises, 1);
  assert.equal(result.plateaus.length, 0);
});

test("counts from the window start when the best is older than it", () => {
  const result = evaluatePlateaus(
    lift(
      "deadlift",
      { weight: 180, reps: 3, daysAgo: 200 },
      repeated(4, 170, 3),
    ),
    NOW,
  );
  assert.equal(result.plateaus.length, 1);
  assert.equal(
    result.plateaus[0].countedSince,
    daysAgo(PLATEAU_WINDOW_DAYS).toISOString(),
  );
});

test("orders by sessions without a new best, then the older best", () => {
  const result = evaluatePlateaus(
    [
      ...lift("a", { weight: 60, reps: 5, daysAgo: 25 }, repeated(4, 57.5, 5)),
      ...lift(
        "b",
        { weight: 60, reps: 5, daysAgo: 40 },
        repeated(6, 57.5, 5, 34),
      ),
      ...lift("c", { weight: 60, reps: 5, daysAgo: 45 }, repeated(4, 57.5, 5)),
    ],
    NOW,
  );
  assert.deepEqual(
    result.plateaus.map((plateau) => plateau.exerciseId),
    ["b", "c", "a"],
  );
});

test("the service reads the owner's bests and bounded window only", async () => {
  let sql: any;
  const db = {
    $queryRaw: async (query: any) => {
      sql = query;
      return [];
    },
  } as unknown as DatabaseService;
  const result = await new WorkoutPlateausService(db).getPlateaus(
    "user-1",
    NOW,
  );
  assert.deepEqual(result.plateaus, []);
  const text = sql.strings.join(" ");
  assert.match(text, /FROM "PersonalRecord" records/);
  assert.match(text, /sessions\."endedAt" >= /);
  assert.ok(sql.values.includes("user-1"));
  assert.ok(
    sql.values.some(
      (value: unknown) =>
        value instanceof Date &&
        value.getTime() === daysAgo(PLATEAU_WINDOW_DAYS).getTime(),
    ),
  );
});
