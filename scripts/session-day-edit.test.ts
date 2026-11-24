import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import {
  reorderBreaksLinks,
  reorderExerciseLinks,
  type WorkoutSessionSnapshotV1,
} from "@sunsteel/contracts";

import {
  assertSetNumbers,
  dayEditPlan,
  reorderedDay,
} from "../src/workouts/session-day-edit";

type Slot = WorkoutSessionSnapshotV1["routineDay"]["exercises"][number];

const slot = (id: string, order: number, linkedToNext = false) =>
  ({ id, order, linkedToNext }) as unknown as Slot;

describe("LIVE-25: reordering the day", () => {
  const day = [slot("a", 0), slot("b", 1, true), slot("c", 2), slot("d", 3)];

  it("renumbers the day in the new order", () => {
    const next = reorderedDay(day, ["d", "a", "b", "c"]);
    assert.deepEqual(
      next.map((e) => [e.id, e.order]),
      [
        ["d", 0],
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ],
    );
  });

  it("keeps a superset while its pair stays side by side", () => {
    const next = reorderedDay(day, ["b", "c", "a", "d"]);
    assert.equal(next[0].linkedToNext, true);
    assert.equal(reorderBreaksLinks(day, ["b", "c", "a", "d"]), false);
  });

  it("drops the link when the pair is split, and says so", () => {
    const next = reorderedDay(day, ["b", "a", "c", "d"]);
    assert.equal(next.some((e) => e.linkedToNext), false);
    assert.equal(reorderBreaksLinks(day, ["b", "a", "c", "d"]), true);
  });

  it("never links the day's last exercise", () => {
    const next = reorderExerciseLinks(
      [slot("a", 0, true), slot("b", 1)],
      ["b", "a"],
    );
    assert.equal(next[1].linkedToNext, false);
  });

  it("refuses an order that does not name every exercise once", () => {
    for (const ids of [
      ["a", "b", "c"],
      ["a", "b", "c", "c"],
      ["a", "b", "c", "x"],
    ])
      assert.throws(() => reorderedDay(day, ids), BadRequestException);
  });
});

describe("LIVE-25: adding an exercise", () => {
  it("writes to the plan being trained", () => {
    assert.equal(
      dayEditPlan({ trainingBlockId: null, temporaryOverrideId: null }),
      "ROUTINE",
    );
    assert.equal(
      dayEditPlan({ trainingBlockId: "b", temporaryOverrideId: null }),
      "TRAINING_BLOCK",
    );
    assert.equal(
      dayEditPlan({ trainingBlockId: "b", temporaryOverrideId: "o" }),
      "DELOAD",
    );
  });

  it("takes sets numbered 1, 2, 3 with no gap", () => {
    assert.doesNotThrow(() =>
      assertSetNumbers([{ setNumber: 2 }, { setNumber: 1 }]),
    );
    assert.throws(
      () => assertSetNumbers([{ setNumber: 1 }, { setNumber: 3 }]),
      BadRequestException,
    );
  });
});
