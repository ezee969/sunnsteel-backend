import "reflect-metadata";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { MUSCLE_GROUPS } from "@sunsteel/contracts";
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

test("muscle heatmap fills zero cells and maps weighted weekly rollups", async () => {
  const currentWeek = weekDate(localDate(new Date(), "Europe/Berlin"));
  const previousWeek = getHeatmapWeekStarts(currentWeek, 2)[0];
  let receivedQuery: any;
  const tx = {
    $queryRaw: async () => [{ id: "projection-1", timeZone: "Europe/Berlin" }],
    workoutMuscleRollup: {
      findMany: async (query: any) => {
        receivedQuery = query;
        return [
          { date: previousWeek, muscle: "PECTORAL", completedSets: 3 },
          { date: currentWeek, muscle: "TRICEPS", completedSets: 1.5 },
        ];
      },
    },
  };
  const db = {
    $transaction: async (read: any, options: any) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return read(tx);
    },
  } as unknown as DatabaseService;

  const result = await new WorkoutMuscleHeatmapService(db).getMuscleHeatmap(
    "user-1",
    { timeZone: "Europe/Berlin", weeks: 4 },
  );

  assert.equal(result.weeks.length, 4);
  assert.equal(result.weeks[0].muscles.length, MUSCLE_GROUPS.length);
  assert.equal(result.weeks.at(-2)?.totalWeightedSets, 3);
  assert.equal(result.weeks.at(-1)?.totalWeightedSets, 1.5);
  assert.equal(
    result.weeks.at(-1)?.muscles.find((item) => item.muscle === "PECTORAL")
      ?.weightedSets,
    0,
  );
  assert.equal(result.peakWeightedSets, 3);
  assert.deepEqual(receivedQuery.where, {
    projectionId: "projection-1",
    period: "WEEK",
    date: { gte: result.weeks[0].weekStart, lte: currentWeek },
  });
});

test("muscle heatmap refuses a stale or missing analytics projection", async () => {
  const db = {
    $transaction: async (read: any) =>
      read({
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
