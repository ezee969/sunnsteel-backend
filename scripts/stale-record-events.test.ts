import * as assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import {
  RecordEventRow,
  removeStaleRecordEvents,
  staleRecordEvents,
} from "../src/workouts/analytics/stale-record-events";

const event = (
  id: string,
  at: string,
  weight: number,
  reps: number,
  exerciseId = "bench",
): RecordEventRow => ({
  id,
  eventKey: `session:${id}:pr:${exerciseId}:v1`,
  exerciseId,
  occurredAt: new Date(at),
  weight,
  reps,
});

// TD-58, as found on @eze-prof's Bench Press: a real workout's first record
// (50 x 10 on 2026-09-09) after the portfolio seed backdated heavier history
// around it.
const benchHistory = [
  event("a", "2026-07-13T17:06:41Z", 65, 7),
  event("b", "2026-07-20T17:04:27Z", 65, 8),
  event("c", "2026-08-03T17:37:09Z", 67.5, 7),
  event("d", "2026-08-09T07:17:30Z", 72.5, 7),
  event("real", "2026-09-09T08:01:57Z", 50, 10),
  event("e", "2026-09-20T07:20:00Z", 75, 7),
];

test("a record that does not beat the best before it is stale", () => {
  assert.deepEqual(
    staleRecordEvents(benchHistory).map((row) => row.id),
    ["real"],
  );
});

test("the rule walks events in time order, whatever order they arrive in", () => {
  assert.deepEqual(
    staleRecordEvents([...benchHistory].reverse()).map((row) => row.id),
    ["real"],
  );
});

test("removing the stale events leaves a chain with nothing more to remove", () => {
  const kept = benchHistory.filter(
    (row) => !staleRecordEvents(benchHistory).includes(row),
  );
  assert.deepEqual(staleRecordEvents(kept), []);
});

test("a tie is not a record, and each exercise keeps its own frontier", () => {
  const rows = [
    event("bench-1", "2026-09-01T10:00:00Z", 100, 5),
    event("squat-1", "2026-09-02T10:00:00Z", 60, 5, "squat"),
    event("bench-tie", "2026-09-03T10:00:00Z", 100, 5),
    event("bench-reps", "2026-09-04T10:00:00Z", 100, 6),
    // Behind a stale event, the next one is still judged against the best,
    // not against the stale one.
    event("bench-light", "2026-09-05T10:00:00Z", 90, 12),
    event("bench-up", "2026-09-06T10:00:00Z", 95, 12),
  ];
  assert.deepEqual(
    staleRecordEvents(rows).map((row) => row.id),
    ["bench-tie", "bench-light", "bench-up"],
  );
});

test("removing stale records deletes the events and the activity built on them", async () => {
  const calls: Record<string, any[]> = {};
  const record =
    (name: string, result: unknown) =>
    async (query: unknown) => {
      (calls[name] ??= []).push(query);
      return result;
    };
  const payload = (row: RecordEventRow) => ({
    exerciseId: row.exerciseId,
    weight: row.weight,
    reps: row.reps,
  });
  const tx = {
    trainingEvent: {
      findMany: record("findEvents", [
        ...benchHistory.map((row) => ({
          id: row.id,
          eventKey: row.eventKey,
          occurredAt: row.occurredAt,
          payload: payload(row),
        })),
        // A malformed payload is left alone rather than judged.
        {
          id: "odd",
          eventKey: "session:odd:pr:bench:v1",
          occurredAt: new Date("2026-09-30T00:00:00Z"),
          payload: { exerciseId: "bench", weight: "heavy", reps: 5 },
        },
      ]),
      deleteMany: record("deleteEvents", { count: 1 }),
    },
    activityComment: {
      findMany: record("findComments", [{ id: "comment-1" }]),
      deleteMany: record("deleteComments", { count: 1 }),
    },
    notification: { deleteMany: record("deleteNotifications", { count: 1 }) },
    activityEntryReaction: { deleteMany: record("deleteReactions", { count: 1 }) },
    activityEntryOverride: { deleteMany: record("deleteOverrides", { count: 0 }) },
  } as unknown as Prisma.TransactionClient;

  const removed = await removeStaleRecordEvents(tx, "user-1");

  const key = "session:real:pr:bench:v1";
  assert.deepEqual(removed, [key]);
  assert.deepEqual(calls.findEvents[0].where, {
    userId: "user-1",
    type: "PERSONAL_RECORD",
  });
  assert.deepEqual(calls.deleteEvents[0].where, { id: { in: ["real"] } });
  assert.deepEqual(calls.deleteNotifications[0].where, {
    userId: "user-1",
    sourceKey: { in: ["comment:comment-1"] },
  });
  assert.deepEqual(calls.deleteComments[0].where, {
    entryKey: { in: [key] },
    authorId: "user-1",
  });
  assert.deepEqual(calls.deleteReactions[0].where, {
    entryKey: { in: [key] },
    authorId: "user-1",
  });
  assert.deepEqual(calls.deleteOverrides[0].where, {
    userId: "user-1",
    entryKey: { in: [key] },
  });
});

test("an account with a clean chain is left untouched", async () => {
  const tx = {
    trainingEvent: {
      findMany: async () =>
        benchHistory
          .filter((row) => row.id !== "real")
          .map((row) => ({
            id: row.id,
            eventKey: row.eventKey,
            occurredAt: row.occurredAt,
            payload: {
              exerciseId: row.exerciseId,
              weight: row.weight,
              reps: row.reps,
            },
          })),
      deleteMany: async () => assert.fail("nothing is stale"),
    },
  } as unknown as Prisma.TransactionClient;
  assert.deepEqual(await removeStaleRecordEvents(tx, "user-1"), []);
});
