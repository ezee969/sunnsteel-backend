import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import {
  movedDay,
  movedGroupDay,
  reorderBreaksLinks,
  reorderExerciseLinks,
  ungroupedDay,
  type WorkoutSessionSnapshotV1,
} from "@sunsteel/contracts";

import {
  assertSetNumbers,
  dayEditPlan,
  plannedExerciseRemoval,
  plannedSetRemoval,
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
    assert.equal(
      next.some((e) => e.linkedToNext),
      false,
    );
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

describe("LIVE-29: moving with groups kept", () => {
  // x, then superset a+b, then y.
  const day = [slot("x", 0), slot("a", 1, true), slot("b", 2), slot("y", 3)];
  const shape = (next: Slot[]) =>
    next.map((e) => e.id + (e.linkedToNext ? "+" : "")).join(" ");
  const apply = (order: { ids: string[]; linkedToNext: boolean[] } | null) => {
    assert.ok(order);
    return shape(reorderedDay(day, order.ids, order.linkedToNext));
  };

  it("an exercise on its own jumps the whole superset", () => {
    assert.equal(apply(movedDay(day, "x", 1)), "a+ b x y");
    assert.equal(apply(movedDay(day, "y", -1)), "x y a+ b");
  });

  it("a member moves inside its group and the group stays", () => {
    assert.equal(apply(movedDay(day, "a", 1)), "x b+ a y");
    assert.equal(movedDay(day, "a", -1), null);
    assert.equal(movedDay(day, "b", 1), null);
  });

  it("a group moves as one", () => {
    assert.equal(apply(movedGroupDay(day, "b", -1)), "a+ b x y");
    assert.equal(apply(movedGroupDay(day, "a", 1)), "x y a+ b");
    assert.equal(movedGroupDay(day, "x", 1), null);
  });

  it("an exercise taken out goes on its own right after the group", () => {
    assert.equal(apply(ungroupedDay(day, "a")), "x b a y");
    const circuit = [slot("a", 0, true), slot("b", 1, true), slot("c", 2), slot("d", 3)];
    const order = ungroupedDay(circuit, "a");
    assert.ok(order);
    assert.equal(shape(reorderedDay(circuit, order.ids, order.linkedToNext)), "b+ c a d");
    assert.equal(ungroupedDay(day, "x"), null);
  });

  it("never links the last and refuses links that do not fit", () => {
    assert.equal(shape(reorderedDay(day, ["x", "a", "b", "y"], [false, true, false, true])), "x a+ b y");
    assert.throws(() => reorderedDay(day, ["x", "a", "b", "y"], [true]), BadRequestException);
    const seven = Array.from({ length: 7 }, (_, i) => slot(`e${i}`, i));
    assert.throws(
      () => reorderedDay(seven, seven.map((e) => e.id), seven.map(() => true)),
      BadRequestException,
    );
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

describe("LIVE-27: removing a set during a workout", () => {
  type Set = Slot["sets"][number];
  const set = (setNumber: number, kind: Set["kind"] = "WORKING") =>
    ({ setNumber, kind, repType: "FIXED", reps: 10 }) as Set;
  const free = { done: false, linearBlock: false };

  it("drops the set and renumbers the ones after it", () => {
    const plan = plannedSetRemoval(
      [set(1, "WARMUP"), set(2), set(3), set(4)],
      2,
      free,
    );
    assert.ok("sets" in plan);
    assert.deepEqual(
      plan.sets.map((s) => [s.setNumber, s.kind]),
      [
        [1, "WARMUP"],
        [2, "WORKING"],
        [3, "WORKING"],
      ],
    );
  });

  it("refuses a done set, the last set and a set not prescribed", () => {
    assert.deepEqual(
      plannedSetRemoval([set(1), set(2)], 2, { ...free, done: true }),
      { refusal: "SET_REMOVE_DONE" },
    );
    assert.deepEqual(plannedSetRemoval([set(1)], 1, free), {
      refusal: "SET_REMOVE_LAST",
    });
    assert.deepEqual(plannedSetRemoval([set(1), set(2)], 3, free), {
      refusal: "SET_REMOVE_NOT_PRESCRIBED",
    });
  });

  it("keeps an 8-week block's working sets and lets its warm-ups go", () => {
    const block = { ...free, linearBlock: true };
    assert.deepEqual(
      plannedSetRemoval([set(1, "WARMUP"), set(2), set(3)], 2, block),
      { refusal: "SET_REMOVE_LINEAR_BLOCK" },
    );
    assert.ok(
      "sets" in plannedSetRemoval([set(1, "WARMUP"), set(2)], 1, block),
    );
  });

  it("never leaves a match set without the working set it follows", () => {
    // With no working set left before it, the match set has nothing to match.
    assert.deepEqual(
      plannedSetRemoval([set(1, "WARMUP"), set(2), set(3, "MATCH")], 2, free),
      { refusal: "MATCH_SET_PLACEMENT" },
    );
    // With another working set before it, it matches that one instead.
    assert.ok(
      "sets" in plannedSetRemoval([set(1), set(2), set(3, "MATCH")], 2, free),
    );
    const plan = plannedSetRemoval([set(1), set(2), set(3, "MATCH")], 1, free);
    assert.ok("sets" in plan);
    assert.deepEqual(
      plan.sets.map((s) => s.kind),
      ["WORKING", "MATCH"],
    );
    assert.ok("sets" in plannedSetRemoval([set(1), set(2, "MATCH")], 2, free));
  });
});

describe("LIVE-28: removing an exercise during a workout", () => {
  const ids = (plan: ReturnType<typeof plannedExerciseRemoval>) => {
    assert.ok("exercises" in plan);
    return plan.exercises.map(
      (e) => `${e.id}${e.order}${e.linkedToNext ? "+" : ""}`,
    );
  };

  it("drops the exercise and closes up the day", () => {
    const day = [slot("a", 0), slot("b", 1), slot("c", 2)];
    assert.deepEqual(ids(plannedExerciseRemoval(day, "b")), ["a0", "c1"]);
  });

  it("bridges a group a middle member leaves", () => {
    const day = [slot("a", 0, true), slot("b", 1, true), slot("c", 2)];
    assert.deepEqual(ids(plannedExerciseRemoval(day, "b")), ["a0+", "c1"]);
  });

  it("ends a superset whose second member goes", () => {
    const day = [slot("a", 0, true), slot("b", 1), slot("c", 2)];
    assert.deepEqual(ids(plannedExerciseRemoval(day, "b")), ["a0", "c1"]);
    const last = [slot("a", 0), slot("b", 1, true), slot("c", 2)];
    assert.deepEqual(ids(plannedExerciseRemoval(last, "c")), ["a0", "b1"]);
  });

  it("keeps the day's one exercise and refuses one not in it", () => {
    assert.deepEqual(plannedExerciseRemoval([slot("a", 0)], "a"), {
      refusal: "DAY_EDIT_LAST_EXERCISE",
    });
    assert.deepEqual(plannedExerciseRemoval([slot("a", 0), slot("b", 1)], "x"), {
      refusal: "SESSION_EXERCISE_NOT_FOUND",
    });
  });
});
