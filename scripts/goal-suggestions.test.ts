import "reflect-metadata";
import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  type GoalSuggestion,
  goalSuggestionKey,
  isGoalSuggestionKey,
  MEASURABLE_GOALS_MAX,
  weekStartOf,
} from "@sunsteel/contracts";
import { DatabaseService } from "../src/database/database.service";
import { localDate } from "../src/workouts/analytics/analytics-contribution";
import {
  chooseSuggestedLift,
  plannedWorkoutsInWeek,
  recentWeeklyVolume,
  selectGoalSuggestions,
  strengthTarget,
  volumeTarget,
  WorkoutGoalSuggestionsService,
} from "../src/workouts/workout-goal-suggestions.service";

const created = new Date("2026-01-01T00:00:00Z");
const weekly = (id: string, weekdays: number[], restDays: number[] = []) => ({
  id,
  name: id,
  scheduleMode: "WEEKLY" as const,
  isCompleted: false,
  createdAt: created,
  restDays,
  rotationWeekdays: [],
  days: weekdays.map((dayOfWeek) => ({ dayOfWeek })),
});

test("ACH-06 the plan's workouts in one week", () => {
  // Monday 2026-09-28 to Sunday 2026-10-04.
  const week = "2026-09-28";
  assert.equal(plannedWorkoutsInWeek([weekly("upper-lower", [1, 2, 4, 5])], [], week), 4);
  // Two routines on one day are two workouts.
  assert.equal(
    plannedWorkoutsInWeek([weekly("a", [1, 3]), weekly("b", [1])], [], week),
    3,
  );
  // A skip removes one; a move keeps it in the week.
  assert.equal(
    plannedWorkoutsInWeek(
      [weekly("a", [1, 3])],
      [
        { routineId: "a", kind: "SKIP", date: "2026-09-28", toDate: null },
        { routineId: "a", kind: "MOVE", date: "2026-09-30", toDate: "2026-10-01" },
      ],
      week,
    ),
    1,
  );
  // A rotation without training weekdays has no dates; an archived routine plans nothing.
  assert.equal(
    plannedWorkoutsInWeek(
      [
        { ...weekly("rot", []), scheduleMode: "ROTATION", days: [{ dayOfWeek: null }] },
        { ...weekly("old", [1, 2]), isCompleted: true },
      ],
      [],
      week,
    ),
    0,
  );
});

test("ACH-06 recent weekly volume counts idle weeks and the member's week", () => {
  const current = "2026-09-28";
  const rows = [
    { date: "2026-08-31", volumeKg: 9_000 }, // first of the four weeks
    { date: "2026-09-08", volumeKg: 6_000 },
    { date: "2026-09-10", volumeKg: 5_000 },
    { date: "2026-09-28", volumeKg: 99_999 }, // this week: never counted
    { date: "2026-08-30", volumeKg: 99_999 }, // before the window
  ];
  assert.deepEqual(recentWeeklyVolume(rows, current, 1), {
    averageVolumeKg: 5_000,
    activeWeeks: 2,
  });
  // A Sunday week moves Sunday 2026-09-27 into the window's last week.
  const sunday = weekStartOf("2026-09-28", 0);
  assert.equal(sunday, "2026-09-27");
  assert.deepEqual(
    recentWeeklyVolume([{ date: "2026-09-26", volumeKg: 4_000 }], sunday, 0),
    { averageVolumeKg: 1_000, activeWeeks: 1 },
  );
});

test("ACH-06 targets read as round numbers in the member's unit", () => {
  assert.equal(volumeTarget(21_992, "KG"), 22_000);
  assert.equal(volumeTarget(30, "KG"), 100);
  // 10,000 kg is 22,046 lb: suggested as 22,000 lb, stored in kg.
  assert.ok(Math.abs(volumeTarget(10_000, "LB") - 22_000 / 2.2046226218) < 0.001);
  // 140 kg + 2.5% = 143.5, up to the next 2.5 kg.
  assert.equal(strengthTarget(140, "KG"), 145);
  // Already on the grid after the step: still above the best.
  assert.equal(strengthTarget(100, "KG"), 102.5);
  // 100 kg is 220.46 lb; +2.5% = 225.97, up to 230 lb.
  assert.ok(Math.abs(strengthTarget(100, "LB") - 230 / 2.2046226218) < 0.001);
  for (const best of [20, 61.3, 142.5, 180]) {
    assert.ok(strengthTarget(best, "KG") > best);
    assert.ok(strengthTarget(best, "LB") > best);
  }
});

test("ACH-06 the most-trained lift with a stored best", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 8, day));
  const lift = (exerciseId: string, sessions: number, day: number, best: number | null = 100) => ({
    exerciseId,
    name: exerciseId,
    sessions,
    lastEndedAt: at(day),
    bestEstimated1rmKg: best,
  });
  assert.equal(
    chooseSuggestedLift([lift("bench", 6, 20), lift("squat", 8, 10)])?.exerciseId,
    "squat",
  );
  // A tie goes to the lift trained most recently.
  assert.equal(
    chooseSuggestedLift([lift("bench", 6, 20), lift("row", 6, 25)])?.exerciseId,
    "row",
  );
  // Without a best, or under the minimum workouts, a lift is never chosen.
  assert.equal(chooseSuggestedLift([lift("press", 9, 20, null), lift("curl", 2, 20)]), null);
});

test("ACH-06 suggestions skip goals held, dismissals at the same number and full slots", () => {
  const suggestion = (
    type: GoalSuggestion["type"],
    targetValue: number,
    exerciseId?: string,
  ): GoalSuggestion => ({
    key: goalSuggestionKey(type, exerciseId),
    type,
    targetValue,
    direction: "AT_LEAST",
    exercise: exerciseId ? { id: exerciseId, name: exerciseId } : null,
    basis: { kind: "PLAN", plannedWorkouts: 4, weekStart: "2026-09-28" },
  });
  const all = [
    suggestion("WEEKLY_SESSIONS", 4),
    suggestion("WEEKLY_VOLUME", 22_000),
    suggestion("EXERCISE_ESTIMATED_1RM", 145, "bench"),
  ];
  assert.deepEqual(
    selectGoalSuggestions(all, new Set(), [], 8).map((item) => item.type),
    ["WEEKLY_SESSIONS", "WEEKLY_VOLUME", "EXERCISE_ESTIMATED_1RM"],
  );
  assert.deepEqual(
    selectGoalSuggestions(all, new Set(["WEEKLY_VOLUME"]), [], 8).map((item) => item.type),
    ["WEEKLY_SESSIONS", "EXERCISE_ESTIMATED_1RM"],
  );
  // Set aside at 4, hidden; the plan now says 5, so it returns.
  const dismissed = [{ key: "WEEKLY_SESSIONS", targetValue: 4 }];
  assert.equal(selectGoalSuggestions(all, new Set(), dismissed, 8)[0].type, "WEEKLY_VOLUME");
  assert.equal(
    selectGoalSuggestions([suggestion("WEEKLY_SESSIONS", 5)], new Set(), dismissed, 8).length,
    1,
  );
  assert.equal(selectGoalSuggestions(all, new Set(), [], 1).length, 1);
  // A target the goals write would refuse is never offered.
  assert.deepEqual(
    selectGoalSuggestions(
      [suggestion("EXERCISE_ESTIMATED_1RM", 5_278_750, "curl"), suggestion("WEEKLY_SESSIONS", 15)],
      new Set(),
      [],
      8,
    ),
    [],
  );
  assert.equal(selectGoalSuggestions(all, new Set(), [], 0).length, 0);
  assert.ok(isGoalSuggestionKey("EXERCISE_ESTIMATED_1RM:3b0035fb-42df-5358-83a0-f11211509fe0"));
  assert.ok(!isGoalSuggestionKey("BODY_WEIGHT"));
  assert.ok(!isGoalSuggestionKey("STREAK_DAYS"));
});

test("ACH-06 the service reads only what a missing goal needs", async () => {
  const today = localDate(new Date(), "UTC");
  const weekStart = weekStartOf(today, 1);
  const reads: string[] = [];
  const db = (goalTypes: string[], dismissals: Array<{ key: string; targetValue: number }>) =>
    ({
      $queryRaw: async (strings: TemplateStringsArray | { sql?: string }) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String((strings as { sql?: string }).sql ?? strings);
        if (sql.includes("WorkoutAnalyticsProjection")) {
          reads.push("projection");
          return [{ id: "projection" }];
        }
        reads.push("lifts");
        return [
          // The most trained, but its logged best is implausible: passed over.
          { exerciseId: "curl-typo", sessions: 9, lastEndedAt: new Date() },
          { exerciseId: "bench", sessions: 5, lastEndedAt: new Date() },
          { exerciseId: "curl", sessions: 2, lastEndedAt: new Date() },
        ];
      },
      user: { findUnique: async () => ({ weightUnit: "KG", weekStartsOn: 1 }) },
      measurableGoal: { findMany: async () => goalTypes.map((type) => ({ type })) },
      goalSuggestionDismissal: { findMany: async () => dismissals },
      routine: {
        findMany: async () => {
          reads.push("routines");
          return [
            {
              ...weekly("split", [1, 3, 5]),
              trainingBlocks: [],
              temporaryOverrides: [],
            },
          ];
        },
      },
      scheduleOverride: { findMany: async () => [] },
      workoutRollup: {
        findMany: async (args: { where: { period: string; date: { gte: string; lt: string } } }) => {
          reads.push("volume");
          assert.equal(args.where.period, "DAY");
          assert.equal(args.where.date.lt, weekStart);
          return [
            { date: args.where.date.gte, volumeKg: 20_000 },
            // Two of the four weeks active: (20,000 + 24,000) / 4 = 11,000.
            { date: addDays(args.where.date.gte, 7), volumeKg: 24_000 },
          ];
        },
      },
      personalRecord: {
        findMany: async () => [
          { exerciseId: "bench", estimated1rm: 140 },
          { exerciseId: "curl-typo", estimated1rm: 5_150_000 },
        ],
      },
      exercise: {
        findMany: async () => [
          { id: "bench", name: "Bench Press" },
          { id: "curl-typo", name: "Barbell Curl" },
        ],
      },
    }) as unknown as DatabaseService;

  const result = await new WorkoutGoalSuggestionsService(db([], [])).getGoalSuggestions(
    "user-1",
    { timeZone: "UTC" },
  );
  assert.equal(result.freeSlots, MEASURABLE_GOALS_MAX);
  assert.deepEqual(
    result.suggestions.map((item) => [item.type, item.targetValue]),
    [
      ["WEEKLY_SESSIONS", 3],
      ["WEEKLY_VOLUME", 11_000],
      ["EXERCISE_ESTIMATED_1RM", 145],
    ],
  );
  assert.deepEqual(result.suggestions[2].exercise, { id: "bench", name: "Bench Press" });
  assert.deepEqual(result.suggestions[0].basis, {
    kind: "PLAN",
    plannedWorkouts: 3,
    weekStart,
  });

  // With every type held, nothing beyond the projection, the user and the goals is read.
  reads.length = 0;
  const held = await new WorkoutGoalSuggestionsService(
    db(["WEEKLY_SESSIONS", "WEEKLY_VOLUME", "EXERCISE_ESTIMATED_1RM"], []),
  ).getGoalSuggestions("user-1", { timeZone: "UTC" });
  assert.deepEqual(held.suggestions, []);
  assert.deepEqual(reads, ["projection"]);
});

test("ACH-06 a stale projection refuses, as every progress read does", async () => {
  const db = {
    $queryRaw: async () => [],
    user: { findUnique: async () => null },
    measurableGoal: { findMany: async () => [] },
    goalSuggestionDismissal: { findMany: async () => [] },
  } as unknown as DatabaseService;
  await assert.rejects(
    new WorkoutGoalSuggestionsService(db).getGoalSuggestions("user-1", { timeZone: "UTC" }),
    /projection is not ready/,
  );
});

test("ACH-06 a dismissal is stored by key and the oldest beyond the limit go", async () => {
  const calls: string[] = [];
  const tx = {
    goalSuggestionDismissal: {
      upsert: async (args: { create: { key: string; targetValue: number } }) => {
        calls.push(`upsert ${args.create.key} ${args.create.targetValue}`);
      },
      findMany: async () => [{ key: "EXERCISE_ESTIMATED_1RM:old" }],
      deleteMany: async (args: { where: { key: { in: string[] } } }) => {
        calls.push(`delete ${args.where.key.in.join(",")}`);
      },
    },
  };
  const db = {
    $transaction: async (run: (client: typeof tx) => unknown) => run(tx),
  } as unknown as DatabaseService;
  const service = new WorkoutGoalSuggestionsService(db);
  assert.deepEqual(await service.dismiss("user-1", { key: "WEEKLY_SESSIONS", targetValue: 4 }), {
    key: "WEEKLY_SESSIONS",
    targetValue: 4,
  });
  assert.deepEqual(calls, ["upsert WEEKLY_SESSIONS 4", "delete EXERCISE_ESTIMATED_1RM:old"]);
  await assert.rejects(service.dismiss("user-1", { key: "BODY_WEIGHT", targetValue: 80 }), /Unknown/);
  await assert.rejects(service.dismiss("user-1", { key: "WEEKLY_VOLUME", targetValue: 0 }), /Invalid/);
});

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
