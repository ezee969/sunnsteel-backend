import "reflect-metadata";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { MUSCLE_GROUPS, weekStartOf } from "@sunsteel/contracts";
import { DatabaseService } from "../src/database/database.service";
import {
  localDate,
  weekDate,
} from "../src/workouts/analytics/analytics-contribution";
import {
  getHeatmapWeekStarts,
  WorkoutMuscleHeatmapService,
} from "../src/workouts/workout-muscle-heatmap.service";

test("heatmap week starts are chronological Mondays across year boundaries", () => {
  assert.deepEqual(getHeatmapWeekStarts("2026-01-05", 4), [
    "2025-12-15",
    "2025-12-22",
    "2025-12-29",
    "2026-01-05",
  ]);
});

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const heatmapDb = (
  weekStartsOn: number,
  rows: Array<{ date: string; muscle: string; completedSets: number }>,
  queries: any[],
) =>
  ({
    $transaction: async (read: any, options: any) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return read({
        user: { findUnique: async () => ({ weekStartsOn }) },
        $queryRaw: async () => [
          { id: "projection-1", timeZone: "Europe/Berlin" },
        ],
        workoutMuscleRollup: {
          findMany: async (query: any) => {
            queries.push(query);
            return rows;
          },
        },
      });
    },
  }) as unknown as DatabaseService;

test("muscle heatmap fills zero cells and sums day rollups into weeks", async () => {
  const today = localDate(new Date(), "Europe/Berlin");
  const currentWeek = weekDate(today);
  const previousWeek = getHeatmapWeekStarts(currentWeek, 2)[0];
  const queries: any[] = [];
  const db = heatmapDb(
    1,
    [
      { date: previousWeek, muscle: "PECTORAL", completedSets: 1.5 },
      { date: addDays(previousWeek, 3), muscle: "PECTORAL", completedSets: 1.5 },
      { date: currentWeek, muscle: "TRICEPS", completedSets: 1.5 },
    ],
    queries,
  );

  const result = await new WorkoutMuscleHeatmapService(db).getMuscleHeatmap(
    "user-1",
    { timeZone: "Europe/Berlin", weeks: 4 },
  );

  assert.equal(result.weeks.length, 4);
  assert.equal(result.weeks[0].muscles.length, MUSCLE_GROUPS.length);
  assert.equal(result.weeks.at(-2)?.totalWeightedSets, 3);
  assert.equal(result.weeks.at(-1)?.totalWeightedSets, 1.5);
  assert.equal(result.weeks.at(-1)?.weekStart, currentWeek);
  assert.equal(
    result.weeks.at(-1)?.muscles.find((item) => item.muscle === "PECTORAL")
      ?.weightedSets,
    0,
  );
  assert.equal(result.peakWeightedSets, 3);
  assert.deepEqual(queries[0].where, {
    projectionId: "projection-1",
    period: "DAY",
    date: { gte: result.weeks[0].weekStart, lte: today },
  });
});

test("muscle heatmap follows a Sunday week (PREF-04)", async () => {
  const today = localDate(new Date(), "Europe/Berlin");
  const currentWeek = weekStartOf(today, 0);
  const queries: any[] = [];
  const db = heatmapDb(
    0,
    [
      // The Saturday before belongs to the week before; the Sunday opens this one.
      { date: addDays(currentWeek, -1), muscle: "QUADRICEPS", completedSets: 2 },
      { date: currentWeek, muscle: "QUADRICEPS", completedSets: 4 },
    ],
    queries,
  );

  const result = await new WorkoutMuscleHeatmapService(db).getMuscleHeatmap(
    "user-1",
    { timeZone: "Europe/Berlin", weeks: 4 },
  );

  assert.equal(new Date(`${result.weeks[0].weekStart}T00:00:00Z`).getUTCDay(), 0);
  assert.equal(result.weeks.at(-1)?.weekStart, currentWeek);
  assert.equal(result.weeks.at(-1)?.isCurrentWeek, true);
  assert.equal(result.weeks.at(-1)?.totalWeightedSets, 4);
  assert.equal(result.weeks.at(-2)?.totalWeightedSets, 2);
  assert.equal(queries[0].where.date.gte, result.weeks[0].weekStart);
});

test("muscle heatmap refuses a stale or missing analytics projection", async () => {
  const db = {
    $transaction: async (read: any) =>
      read({
        user: { findUnique: async () => null },
        $queryRaw: async () => [],
        workoutMuscleRollup: {
          findMany: async () => assert.fail("rollups must not be queried"),
        },
      }),
  } as unknown as DatabaseService;

  await assert.rejects(
    new WorkoutMuscleHeatmapService(db).getMuscleHeatmap("user-1", {
      timeZone: "Europe/Berlin",
    }),
    /projection is not ready/,
  );
});
