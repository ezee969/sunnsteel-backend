import "reflect-metadata";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { DatabaseService } from "../src/database/database.service";
import { WorkoutExercisePerformanceService } from "../src/workouts/workout-exercise-performance.service";

const snapshot = {
  schemaVersion: 1,
  sessionId: "session-1",
  sourceRoutineId: "routine-1",
  sourceRoutineDayId: "day-1",
  capturedAt: "2026-01-01T00:00:00.000Z",
  provenance: "CAPTURED",
  notes: null,
  routine: { id: "routine-1", name: "Upper Strength" },
  routineDay: {
    id: "day-1",
    dayOfWeek: 1,
    exercises: [
      {
        id: "routine-exercise-1",
        order: 0,
        restSeconds: 120,
        note: "Pause on the chest",
        progressionScheme: "DOUBLE_PROGRESSION",
        minWeightIncrement: 2.5,
        exercise: {
          id: "exercise-1",
          name: "Bench Press",
          primaryMuscles: ["PECTORAL"],
        },
        sets: [
          {
            id: "set-1",
            setNumber: 1,
            repType: "RANGE",
            minReps: 6,
            maxReps: 8,
            weight: 100,
            rir: 2,
          },
        ],
      },
    ],
  },
};

test("exercise history maps session context, completed sets, notes and progression", async () => {
  const rawCalls: string[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      rawCalls.push(sql);
      return rawCalls.length === 1
        ? [
            {
              exerciseId: "exercise-1",
              exerciseName: "Bench Press",
              lastPerformedAt: new Date("2026-02-02T11:00:00.000Z"),
              hasStrengthTrend: true,
            },
          ]
        : [
            {
              sessionId: "session-1",
              payload: {
                routineExerciseId: "routine-exercise-1",
                exerciseId: "exercise-1",
                exerciseName: "Bench Press",
                progressionScheme: "DOUBLE_PROGRESSION",
                rule: "ALL_SETS_REACHED_TARGET",
                minWeightIncrementKg: 2.5,
                sets: [
                  {
                    setNumber: 1,
                    targetReps: 8,
                    performedReps: 8,
                    previousWeightKg: 100,
                    newWeightKg: 102.5,
                  },
                ],
              },
            },
          ];
    },
    workoutSession: {
      findMany: async () => [
        {
          id: "session-1",
          status: "COMPLETED",
          startedAt: new Date("2026-02-02T10:00:00.000Z"),
          endedAt: new Date("2026-02-02T11:00:00.000Z"),
          durationSec: 3600,
          notes: "Strong lockout today",
          snapshot: { payload: snapshot },
          setLogs: [
            {
              sourceRoutineExerciseId: "routine-exercise-1",
              routineExerciseId: null,
              setNumber: 1,
              reps: 8,
              weight: 100,
              rpe: 8.5,
            },
          ],
        },
      ],
    },
  };
  const db = {
    $transaction: async (read: any, options: any) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return read(tx);
    },
  } as unknown as DatabaseService;

  const result =
    await new WorkoutExercisePerformanceService(db).getExercisePerformance(
      "user-1",
      { exerciseId: "exercise-1", limit: 10 },
    );

  assert.equal(result.selectedExercise?.exerciseName, "Bench Press");
  assert.equal(result.items[0].routineName, "Upper Strength");
  assert.equal(result.items[0].dayName, "Monday");
  assert.equal(result.items[0].sessionNotes, "Strong lockout today");
  assert.deepEqual(result.items[0].sets[0], {
    routineExerciseId: "routine-exercise-1",
    setNumber: 1,
    reps: 8,
    weightKg: 100,
    rpe: 8.5,
  });
  assert.equal(result.items[0].prescriptions[0].note, "Pause on the chest");
  assert.equal(result.items[0].prescriptions[0].sets[0].maxReps, 8);
  assert.equal(result.items[0].progressionChanges[0].sets[0].newWeightKg, 102.5);
  assert.equal(rawCalls.length, 2);
  assert.match(rawCalls[0], /logs\."exerciseId"/);
  assert.match(rawCalls[1], /PROGRESSION_CHANGED/);
});

test("exercise history returns an honest empty response", async () => {
  const db = {
    $transaction: async (read: any) =>
      read({
        $queryRaw: async () => [],
        workoutSession: { findMany: async () => assert.fail("not queried") },
      }),
  } as unknown as DatabaseService;

  const result =
    await new WorkoutExercisePerformanceService(db).getExercisePerformance(
      "user-1",
      {},
    );
  assert.deepEqual(result, {
    exercises: [],
    selectedExercise: null,
    items: [],
  });
});

test("exercise history validates date ranges and explicit exercise ownership", async () => {
  const service = new WorkoutExercisePerformanceService({} as DatabaseService);
  await assert.rejects(
    service.getExercisePerformance("user-1", {
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    }),
    /from must be before or equal to to/,
  );

  const db = {
    $transaction: async (read: any) =>
      read({
        $queryRaw: async () => [],
        workoutSession: { findMany: async () => assert.fail("not queried") },
      }),
  } as unknown as DatabaseService;
  await assert.rejects(
    new WorkoutExercisePerformanceService(db).getExercisePerformance(
      "user-1",
      { exerciseId: "exercise-missing" },
    ),
    /No completed performance found/,
  );
});
