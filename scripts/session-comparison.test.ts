import * as assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundException } from "@nestjs/common";
import type { WorkoutSessionSnapshotV1 } from "@sunsteel/contracts";
import { DatabaseService } from "../src/database/database.service";
import { WorkoutSessionComparisonService } from "../src/workouts/workout-session-comparison.service";

const latestSnapshot: WorkoutSessionSnapshotV1 = {
  schemaVersion: 1,
  sessionId: "session-latest",
  sourceRoutineId: "routine-1",
  sourceRoutineDayId: "day-1",
  capturedAt: "2026-09-12T18:00:00.000Z",
  provenance: "CAPTURED",
  notes: "Latest snapshot note",
  routine: { id: "routine-1", name: "Upper / Lower - Autumn Block" },
  routineDay: {
    id: "day-1",
    dayOfWeek: 4,
    order: 0,
    exercises: [
      {
        id: "routine-exercise-bench",
        order: 0,
        restSeconds: 180,
        progressionScheme: "DOUBLE_PROGRESSION",
        minWeightIncrement: 2.5,
        exercise: {
          id: "bench",
          name: "Bench Press",
          primaryMuscles: ["PECTORAL"],
          secondaryMuscles: [],
        },
        sets: [],
      },
      {
        id: "routine-exercise-row",
        order: 1,
        restSeconds: 120,
        progressionScheme: "NONE",
        minWeightIncrement: 2.5,
        exercise: {
          id: "row",
          name: "Chest-supported Row",
          primaryMuscles: ["LATISSIMUS_DORSI"],
          secondaryMuscles: [],
        },
        sets: [],
      },
    ],
  },
};

const previousSnapshot: WorkoutSessionSnapshotV1 = {
  ...latestSnapshot,
  sessionId: "session-previous",
  capturedAt: "2026-09-05T18:00:00.000Z",
  routine: { id: "routine-1", name: "Original block name" },
};

test("session comparison returns the latest two executions with snapshot identities", async () => {
  const received: Record<string, any> = {};
  const tx = {
    $queryRaw: async (...query: any[]) => {
      received.sql = query;
      return [
        {
          routineDayId: "day-1",
          routineId: "routine-1",
          routineName: "Upper / Lower - Autumn Block",
          dayOfWeek: 4,
          lastCompletedAt: new Date("2026-09-12T19:00:00.000Z"),
          completedSessionCount: 2,
        },
      ];
    },
    workoutSession: {
      findMany: async (query: any) => {
        received.sessions = query;
        return [
          {
            id: "session-latest",
            startedAt: new Date("2026-09-12T18:00:00.000Z"),
            endedAt: new Date("2026-09-12T19:00:00.000Z"),
            durationSec: 3600,
            totalVolumeKg: 2500,
            completedSets: 2,
            notes: "Strong finish",
            snapshot: { payload: latestSnapshot },
            setLogs: [
              {
                sourceRoutineExerciseId: "routine-exercise-bench",
                routineExerciseId: null,
                exerciseId: "bench",
                setNumber: 1,
                reps: 5,
                weight: 100,
                rpe: 8,
                isCompleted: true,
              },
              {
                sourceRoutineExerciseId: null,
                routineExerciseId: "routine-exercise-bench",
                exerciseId: "bench",
                setNumber: 2,
                reps: 5,
                weight: 100,
                rpe: null,
                isCompleted: true,
              },
            ],
          },
          {
            id: "session-previous",
            startedAt: new Date("2026-09-05T18:00:00.000Z"),
            endedAt: new Date("2026-09-05T18:45:00.000Z"),
            durationSec: null,
            totalVolumeKg: null,
            completedSets: null,
            notes: null,
            snapshot: { payload: previousSnapshot },
            setLogs: [
              {
                sourceRoutineExerciseId: "routine-exercise-bench",
                routineExerciseId: "stale-live-id",
                exerciseId: "bench",
                setNumber: 1,
                reps: 8,
                weight: 90,
                rpe: 9,
                isCompleted: true,
              },
            ],
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

  const result = await new WorkoutSessionComparisonService(
    db,
  ).getSessionComparison("user-1", {});

  assert.equal(result.selectedRoutineDay?.routineDayId, "day-1");
  assert.equal(result.selectedRoutineDay?.dayName, "Thursday");
  assert.equal(result.latestSession?.routineName, latestSnapshot.routine.name);
  assert.equal(result.latestSession?.durationSec, 3600);
  assert.equal(result.latestSession?.totalVolumeKg, 2500);
  assert.equal(result.latestSession?.exercises[0].sets[0].rpe, 8);
  assert.equal(result.latestSession?.exercises[1].sets.length, 0);
  assert.equal(result.previousSession?.routineName, "Original block name");
  assert.equal(result.previousSession?.durationSec, 2700);
  assert.equal(result.previousSession?.totalVolumeKg, 720);
  assert.equal(result.previousSession?.completedSets, 1);
  assert.equal(
    result.previousSession?.exercises[0].sets[0].routineExerciseId,
    "routine-exercise-bench",
  );
  assert.equal(received.sessions.take, 2);
  assert.equal(received.sessions.where.sourceRoutineDayId, undefined);
  assert.equal(received.sessions.where.OR[0].sourceRoutineDayId, "day-1");
  assert.equal(received.sessions.select.setLogs.where.isCompleted, true);
  const sql = received.sql[0].join(" ");
  assert.match(sql, /WorkoutSessionSnapshot/);
  assert.match(sql, /COUNT\(\*\) OVER/);
  assert.match(sql, /LIMIT/);
});

test("session comparison returns an honest empty state without completed sessions", async () => {
  const db = {
    $transaction: async (read: any) =>
      read({
        $queryRaw: async () => [],
        workoutSession: {
          findMany: async () => assert.fail("sessions must not be queried"),
        },
      }),
  } as unknown as DatabaseService;

  const result = await new WorkoutSessionComparisonService(
    db,
  ).getSessionComparison("user-1", {});

  assert.deepEqual(result, {
    routineDays: [],
    selectedRoutineDay: null,
    latestSession: null,
    previousSession: null,
  });
});

test("session comparison rejects routine days outside the bounded result", async () => {
  const db = {
    $transaction: async (read: any) =>
      read({
        $queryRaw: async () => [],
        workoutSession: {
          findMany: async () => assert.fail("sessions must not be queried"),
        },
      }),
  } as unknown as DatabaseService;

  await assert.rejects(
    new WorkoutSessionComparisonService(db).getSessionComparison("user-1", {
      routineDayId: "e277e9dc-5147-4503-9cc8-24ed8963e82c",
    }),
    (error) => error instanceof NotFoundException,
  );
});
