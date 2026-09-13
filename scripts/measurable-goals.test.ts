import * as assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../src/database/database.service";
import {
  MeasurableGoalsService,
  normalizeMeasurableGoalInputs,
} from "../src/goals/measurable-goals.service";
import { localDate } from "../src/workouts/analytics/analytics-contribution";
import {
  calculateGoalProgress,
  WorkoutPersonalGoalsService,
} from "../src/workouts/workout-personal-goals.service";

const timestamp = new Date("2026-09-13T18:00:00.000Z");

test("measurable goals normalize directions and exercise scope", () => {
  const goals = normalizeMeasurableGoalInputs([
    { type: "WEEKLY_SESSIONS", targetValue: 4 },
    {
      type: "BODY_WEIGHT",
      targetValue: 80,
      direction: "AT_MOST",
    },
    {
      type: "EXERCISE_ESTIMATED_1RM",
      targetValue: 150,
      exerciseId: "00000000-0000-4000-8000-000000000001",
    },
  ]);
  assert.equal(goals[0].direction, "AT_LEAST");
  assert.equal(goals[1].direction, "AT_MOST");
  assert.equal(goals[2].exerciseId, "00000000-0000-4000-8000-000000000001");
});

test("measurable goals reject invalid targets, duplicates and shapes", () => {
  assert.throws(
    () =>
      normalizeMeasurableGoalInputs([
        { type: "WEEKLY_SESSIONS", targetValue: 3.5 },
      ]),
    BadRequestException,
  );
  assert.throws(
    () =>
      normalizeMeasurableGoalInputs([
        { type: "STREAK_DAYS", targetValue: 10 },
        { type: "STREAK_DAYS", targetValue: 20 },
      ]),
    /Duplicate measurable goal/,
  );
  assert.throws(
    () =>
      normalizeMeasurableGoalInputs([
        { type: "EXERCISE_ESTIMATED_1RM", targetValue: 100 },
      ]),
    /require an exercise/,
  );
  assert.throws(
    () =>
      normalizeMeasurableGoalInputs([
        { type: "WEEKLY_VOLUME", targetValue: 5000, direction: "AT_MOST" },
      ]),
    /Only body-weight goals/,
  );
});

test("goal progress keeps at-most targets honest without a false percentage", () => {
  assert.deepEqual(calculateGoalProgress(3, 4, "AT_LEAST"), {
    currentValue: 3,
    remainingValue: 1,
    progressPercent: 75,
    achieved: false,
  });
  assert.deepEqual(calculateGoalProgress(78, 80, "AT_MOST"), {
    currentValue: 78,
    remainingValue: 0,
    progressPercent: null,
    achieved: true,
  });
  assert.equal(calculateGoalProgress(null, 100, "AT_LEAST").achieved, null);
});

test("replacing goals is owner-scoped and preserves supplied ids", async () => {
  const received: Record<string, unknown> = {};
  let findCount = 0;
  const saved = {
    id: "00000000-0000-4000-8000-000000000001",
    type: "WEEKLY_SESSIONS" as const,
    targetValue: 4,
    direction: "AT_LEAST" as const,
    exerciseId: null,
    exercise: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const tx = {
    measurableGoal: {
      findMany: async () => {
        findCount += 1;
        return findCount === 1 ? [{ id: saved.id }] : [saved];
      },
      deleteMany: async (query: unknown) => {
        received.delete = query;
      },
      update: async (query: unknown) => {
        received.update = query;
      },
      create: async () => assert.fail("existing goal must be updated"),
    },
    exercise: { count: async () => 0 },
  };
  const db = {
    $transaction: async (read: (client: typeof tx) => unknown) => read(tx),
  } as unknown as DatabaseService;
  const result = await new MeasurableGoalsService(db).replace("user-1", [
    { id: saved.id, type: "WEEKLY_SESSIONS", targetValue: 4 },
  ]);
  assert.equal(result[0].id, saved.id);
  assert.deepEqual((received.update as any).where, { id: saved.id });
  assert.equal((received.delete as any).where.userId, "user-1");
});

test("personal goals compose weekly, streak, strength and body values", async () => {
  const localToday = localDate(new Date(), "UTC");
  const makeGoal = (
    id: string,
    type:
      | "WEEKLY_SESSIONS"
      | "WEEKLY_VOLUME"
      | "STREAK_DAYS"
      | "EXERCISE_ESTIMATED_1RM"
      | "BODY_WEIGHT",
    targetValue: number,
    exercise: { id: string; name: string } | null = null,
  ) => ({
    id,
    type,
    targetValue,
    direction:
      type === "BODY_WEIGHT" ? ("AT_MOST" as const) : ("AT_LEAST" as const),
    exerciseId: exercise?.id ?? null,
    exercise,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const goals = [
    makeGoal("sessions", "WEEKLY_SESSIONS", 4),
    makeGoal("volume", "WEEKLY_VOLUME", 5000),
    makeGoal("streak", "STREAK_DAYS", 10),
    makeGoal("strength", "EXERCISE_ESTIMATED_1RM", 150, {
      id: "bench",
      name: "Bench Press",
    }),
    makeGoal("body", "BODY_WEIGHT", 80),
  ];
  const tx = {
    $queryRaw: async () => [
      {
        id: "projection",
        lastTrainingDate: localToday,
        currentRun: 4,
      },
    ],
    measurableGoal: { findMany: async () => goals },
    user: { findUnique: async () => ({ weight: 82 }) },
    workoutRollup: {
      findUnique: async () => ({ sessions: 3, volumeKg: 4200 }),
    },
    personalRecord: {
      findMany: async () => [{ exerciseId: "bench", estimated1rm: 140 }],
    },
  };
  const db = {
    $transaction: async (
      read: (client: typeof tx) => unknown,
      options: unknown,
    ) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return read(tx);
    },
  } as unknown as DatabaseService;
  const result = await new WorkoutPersonalGoalsService(db).getPersonalGoals(
    "user-1",
    { timeZone: "UTC" },
  );
  assert.deepEqual(
    result.goals.map((goal) => goal.currentValue),
    [3, 4200, 4, 140, 82],
  );
  assert.equal(result.goals[0].periodStart?.length, 10);
  assert.equal(result.goals[3].exercise?.name, "Bench Press");
  assert.equal(result.goals[4].progressPercent, null);
});
