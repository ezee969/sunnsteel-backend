import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkoutSessionSnapshotV1 } from "@sunsteel/contracts";
import { DatabaseService } from "../src/database/database.service";
import {
  mapProgressTimelineItem,
  WorkoutProgressTimelineService,
} from "../src/workouts/workout-progress-timeline.service";

const snapshot: WorkoutSessionSnapshotV1 = {
  schemaVersion: 1,
  sessionId: "session-1",
  sourceRoutineId: "routine-1",
  sourceRoutineDayId: "day-1",
  capturedAt: "2026-09-12T18:00:00.000Z",
  provenance: "CAPTURED",
  notes: null,
  routine: { id: "routine-1", name: "Autumn Block" },
  routineDay: {
    id: "day-1",
    dayOfWeek: 4,
    order: 0,
    exercises: [],
  },
};

const record = (
  id: string,
  weight: number,
  reps: number,
  previousPayload: Record<string, unknown> | null,
) => ({
  id,
  sessionId: "session-1",
  type: "PERSONAL_RECORD" as const,
  occurredAt: new Date("2026-09-12T19:00:00.000Z"),
  payload: {
    exerciseId: "bench",
    exerciseName: "Bench Press",
    weight,
    reps,
    estimated1rm: weight * (1 + reps / 30),
  },
  previousPayload,
});

test("progress timeline explains record frontier changes", () => {
  const first = mapProgressTimelineItem(
    record("first", 100, 5, null),
    snapshot,
  );
  assert.equal(first.type, "PERSONAL_RECORD");
  assert.equal(first.reason, "FIRST_RECORDED_BEST");
  assert.equal(first.session.dayName, "Thursday");

  const heavier = mapProgressTimelineItem(
    record("heavier", 105, 3, {
      weight: 100,
      reps: 5,
      estimated1rm: 116.7,
    }),
    snapshot,
  );
  assert.equal(heavier.type, "PERSONAL_RECORD");
  assert.equal(heavier.reason, "HEAVIER_LOAD");

  const moreReps = mapProgressTimelineItem(
    record("reps", 105, 6, {
      weight: 105,
      reps: 5,
      estimated1rm: 122.5,
    }),
    snapshot,
  );
  assert.equal(moreReps.type, "PERSONAL_RECORD");
  assert.equal(moreReps.reason, "MORE_REPS_AT_SAME_LOAD");
});

test("progress timeline validates progression payloads", () => {
  const item = mapProgressTimelineItem(
    {
      id: "progression-1",
      sessionId: "session-1",
      type: "PROGRESSION_CHANGED",
      occurredAt: new Date("2026-09-12T19:00:00.000Z"),
      previousPayload: null,
      payload: {
        routineExerciseId: "routine-bench",
        exerciseId: "bench",
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
    snapshot,
  );
  assert.equal(item.type, "PROGRESSION_CHANGED");
  assert.equal(item.change.sets[0].newWeightKg, 102.5);
  assert.throws(
    () =>
      mapProgressTimelineItem(
        {
          id: "bad-progression",
          sessionId: "session-1",
          type: "PROGRESSION_CHANGED",
          occurredAt: new Date(),
          previousPayload: null,
          payload: { exerciseId: "bench" },
        },
        snapshot,
      ),
    /Invalid PROGRESSION_CHANGED event payload/,
  );
});

test("progress timeline is owner-scoped, filtered and cursor-paginated", async () => {
  const received: Record<string, any> = {};
  const rows = [
    record("00000000-0000-4000-8000-000000000003", 110, 5, {
      weight: 105,
      reps: 5,
      estimated1rm: 122.5,
    }),
    record("00000000-0000-4000-8000-000000000002", 105, 5, null),
    record("00000000-0000-4000-8000-000000000001", 100, 5, null),
  ];
  const tx = {
    trainingEvent: {
      findFirst: async (query: any) => {
        received.cursor = query;
        return {
          id: query.where.id,
          occurredAt: new Date("2026-09-13T00:00:00.000Z"),
        };
      },
    },
    $queryRaw: async (sql: any) => {
      received.sql = sql;
      return rows;
    },
    workoutSessionSnapshot: {
      findMany: async (query: any) => {
        received.snapshots = query;
        return [{ sessionId: "session-1", payload: snapshot }];
      },
    },
  };
  const db = {
    $transaction: async (read: any, options: any) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return read(tx);
    },
  } as unknown as DatabaseService;

  const result = await new WorkoutProgressTimelineService(
    db,
  ).getProgressTimeline("user-1", {
    type: "PERSONAL_RECORD",
    cursor: "00000000-0000-4000-8000-000000000004",
    limit: 2,
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.nextCursor, "00000000-0000-4000-8000-000000000002");
  assert.equal(received.cursor.where.userId, "user-1");
  assert.equal(received.cursor.where.type, "PERSONAL_RECORD");
  assert.deepEqual(received.snapshots.where.sessionId.in, ["session-1"]);
  assert.match(received.sql.strings.join(" "), /LEFT JOIN LATERAL/);
  assert.match(received.sql.strings.join(" "), /events\."userId"/);
});

test("progress timeline rejects a cursor outside the owner and filter", async () => {
  const db = {
    $transaction: async (read: any) =>
      read({
        trainingEvent: { findFirst: async () => null },
        $queryRaw: async () => assert.fail("events must not be queried"),
      }),
  } as unknown as DatabaseService;

  await assert.rejects(
    new WorkoutProgressTimelineService(db).getProgressTimeline("user-1", {
      cursor: "00000000-0000-4000-8000-000000000004",
    }),
    /Invalid progress timeline cursor/,
  );
});

test("progress timeline narrows to one exercise", async () => {
  const received: Record<string, any> = {};
  const db = {
    $transaction: async (read: any) =>
      read({
        trainingEvent: {
          findFirst: async (query: any) => {
            received.cursor = query;
            return {
              id: query.where.id,
              occurredAt: new Date("2026-09-13T00:00:00.000Z"),
            };
          },
        },
        $queryRaw: async (sql: any) => {
          received.sql = sql;
          return [];
        },
        workoutSessionSnapshot: { findMany: async () => [] },
      }),
  } as unknown as DatabaseService;

  const exerciseId = "00000000-0000-4000-8000-0000000000aa";
  const result = await new WorkoutProgressTimelineService(
    db,
  ).getProgressTimeline("user-1", {
    exerciseId,
    cursor: "00000000-0000-4000-8000-000000000004",
  });

  assert.deepEqual(result, { items: [], nextCursor: undefined });
  // A cursor from another exercise's feed is rejected like a foreign one.
  assert.deepEqual(received.cursor.where.payload, {
    path: ["exerciseId"],
    equals: exerciseId,
  });
  assert.match(
    received.sql.strings.join(" "),
    /events\."payload"->>'exerciseId' =/,
  );
  assert.ok(received.sql.values.includes(exerciseId));
});
