import "reflect-metadata";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import type { WorkoutSessionSnapshotV1 } from "@sunsteel/contracts";
import { DatabaseService } from "../src/database/database.service";
import {
  localDate,
  weekDate,
} from "../src/workouts/analytics/analytics-contribution";
import { getHeatmapWeekStarts } from "../src/workouts/workout-muscle-heatmap.service";
import {
  getVolumeTrendLowerBound,
  WorkoutVolumeTrendService,
} from "../src/workouts/workout-volume-trend.service";

const snapshot: WorkoutSessionSnapshotV1 = {
  schemaVersion: 1,
  sessionId: "session-1",
  sourceRoutineId: "routine-1",
  sourceRoutineDayId: "day-1",
  capturedAt: "2026-01-01T00:00:00.000Z",
  provenance: "CAPTURED",
  notes: null,
  routine: { id: "routine-1", name: "Upper body" },
  routineDay: {
    id: "day-1",
    dayOfWeek: 1,
    order: 0,
    exercises: [],
  },
};

test("volume lower bound includes the earliest IANA offset", () => {
  assert.equal(
    getVolumeTrendLowerBound("2026-09-07").toISOString(),
    "2026-09-06T10:00:00.000Z",
  );
});

test("volume trends fill weeks and compare rollups, routines and exercises", async () => {
  const currentWeek = weekDate(localDate(new Date(), "Europe/Berlin"));
  const weekStarts = getHeatmapWeekStarts(currentWeek, 4);
  const previousWeek = weekStarts.at(-2)!;
  const endedAt = new Date(`${previousWeek}T12:00:00.000Z`);
  const received: Record<string, any> = {};
  const tx = {
    $queryRaw: async () => [{ id: "projection-1" }],
    workoutRollup: {
      findMany: async (query: any) => {
        received.overall = query;
        return [{ date: previousWeek, volumeKg: 1000.125, completedSets: 4 }];
      },
    },
    workoutMuscleRollup: {
      findMany: async (query: any) => {
        received.muscles = query;
        return [
          {
            date: previousWeek,
            muscle: "PECTORAL",
            volumeKg: 750.555,
            completedSets: 2.5,
          },
        ];
      },
    },
    workoutSession: {
      findMany: async (query: any) => {
        received.sessions = query;
        return [
          {
            id: "session-1",
            endedAt,
            sourceRoutineId: "routine-1",
            totalVolumeKg: 1000.125,
            completedSets: 4,
            snapshot: { payload: snapshot },
          },
        ];
      },
    },
    setLog: {
      findMany: async (query: any) => {
        received.logs = query;
        return [
          {
            exerciseId: "bench",
            exercise: { name: "Bench Press" },
            weight: 100,
            reps: 5,
            session: { endedAt },
          },
          {
            exerciseId: "push-up",
            exercise: { name: "Push-up" },
            weight: null,
            reps: 12,
            session: { endedAt },
          },
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

  const result = await new WorkoutVolumeTrendService(db).getVolumeTrend(
    "user-1",
    { timeZone: "Europe/Berlin", weeks: 4 },
  );

  assert.equal(result.overall.length, 4);
  assert.deepEqual(result.overall.at(-2), {
    weekStart: previousWeek,
    isCurrentWeek: false,
    volumeKg: 1000.13,
    completedSets: 4,
  });
  assert.equal(result.overall.at(-1)?.volumeKg, 0);
  const pectoral = result.muscles.find((item) => item.id === "PECTORAL")!;
  assert.equal(pectoral.totalVolumeKg, 750.56);
  assert.equal(pectoral.points.length, 4);
  assert.deepEqual(result.routines[0], {
    id: "routine-1",
    name: "Upper body",
    totalVolumeKg: 1000.13,
    totalCompletedSets: 4,
    points: result.routines[0].points,
  });
  assert.equal(result.exercises[0].name, "Bench Press");
  assert.equal(result.exercises[0].totalVolumeKg, 500);
  assert.equal(
    result.exercises.find((item) => item.name === "Push-up")
      ?.totalCompletedSets,
    1,
  );
  assert.deepEqual(received.overall.where.date, {
    gte: weekStarts[0],
    lte: currentWeek,
  });
  assert.equal(received.sessions.where.status, "COMPLETED");
  assert.equal(received.sessions.where.completedSets.gt, 0);
  assert.ok(received.sessions.where.endedAt.gte instanceof Date);
  assert.equal(received.logs.where.isCompleted, true);
  assert.equal(received.logs.where.session.status, "COMPLETED");
  assert.ok(received.logs.where.session.endedAt.gte instanceof Date);
});

test("volume trends refuse a stale or missing analytics projection", async () => {
  const db = {
    $transaction: async (read: any) =>
      read({
        $queryRaw: async () => [],
        workoutRollup: {
          findMany: async () => assert.fail("rollups must not be queried"),
        },
      }),
  } as unknown as DatabaseService;

  await assert.rejects(
    new WorkoutVolumeTrendService(db).getVolumeTrend("user-1", {
      timeZone: "Europe/Berlin",
    }),
    /projection is not ready/,
  );
});
