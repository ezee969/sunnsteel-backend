import "reflect-metadata";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { DatabaseService } from "../src/database/database.service";
import {
  mapStrengthTrendPoint,
  WorkoutStrengthTrendService,
} from "../src/workouts/workout-strength-trend.service";

const event = (index: number) => ({
  id: `event-${index}`,
  sessionId: `session-${index}`,
  occurredAt: new Date(
    `2026-01-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
  ),
  payload: {
    exerciseId: "exercise-1",
    weight: 100 + index,
    reps: 5,
    estimated1rm: 116.7 + index,
  },
});

test("strength trend maps summaries, a pre-range baseline and chronological points", async () => {
  const rawCalls: string[] = [];
  const tx = {
    personalRecord: {
      findMany: async () => [
        {
          exerciseId: "exercise-1",
          exerciseName: "Bench Press",
          weight: 120,
          reps: 5,
          estimated1rm: 140,
          achievedAt: new Date("2026-03-01T12:00:00.000Z"),
        },
      ],
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      rawCalls.push(sql);
      return rawCalls.length === 1 ? [event(0)] : [event(2), event(1)];
    },
  };
  const db = {
    $transaction: async (read: any, options: any) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return read(tx);
    },
  } as unknown as DatabaseService;

  const result = await new WorkoutStrengthTrendService(db).getStrengthTrend(
    "user-1",
    {
      from: "2026-02-01T00:00:00.000Z",
      to: "2026-03-31T23:59:59.999Z",
    },
  );

  assert.equal(result.selectedExercise?.exerciseName, "Bench Press");
  assert.equal(result.baseline?.sessionId, "session-0");
  assert.deepEqual(
    result.points.map((point) => point.sessionId),
    ["session-1", "session-2"],
  );
  assert.equal(result.points[0].weightKg, 101);
  assert.equal(result.points[0].estimated1rmKg, 117.7);
  assert.equal(result.truncated, false);
  assert.equal(rawCalls.length, 2);
  assert.match(rawCalls[0], /"payload"->>'exerciseId'/);
});

test("strength trend is bounded to the latest 500 record events", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => event(index));
  const db = {
    $transaction: async (read: any) =>
      read({
        personalRecord: {
          findMany: async () => [
            {
              exerciseId: "exercise-1",
              exerciseName: "Bench Press",
              weight: 120,
              reps: 5,
              estimated1rm: 140,
              achievedAt: new Date(),
            },
          ],
        },
        $queryRaw: async () => rows,
      }),
  } as unknown as DatabaseService;

  const result = await new WorkoutStrengthTrendService(db).getStrengthTrend(
    "user-1",
    { to: "2026-12-31T23:59:59.999Z" },
  );
  assert.equal(result.points.length, 500);
  assert.equal(result.truncated, true);
  assert.equal(result.points[0].sessionId, "session-499");
  assert.equal(result.points[499].sessionId, "session-0");
});

test("strength trend validates ranges and event payloads", async () => {
  const service = new WorkoutStrengthTrendService({} as DatabaseService);
  await assert.rejects(
    service.getStrengthTrend("user-1", {
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    }),
    /from must be before or equal to to/,
  );
  assert.throws(
    () =>
      mapStrengthTrendPoint({
        id: "bad-event",
        sessionId: "session-1",
        occurredAt: new Date(),
        payload: { weight: "100", reps: 5, estimated1rm: 116.7 },
      }),
    /Invalid PERSONAL_RECORD event payload/,
  );
});
