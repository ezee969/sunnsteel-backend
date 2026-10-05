import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import {
  advanceLinearPeriodization,
  continueLinearPeriodization,
  type LinearPeriodizationState,
  lpEstimate,
  lpLoadKg,
  lpRecommendation,
  lpStep,
  lpStoredSets,
  roundToIncrement,
  startLinearPeriodization,
} from "@sunsteel/contracts";

import {
  normalizeLinearExercise,
  readLinearState,
  withoutOwnersBlocks,
} from "../src/routines/linear-periodization";
import {
  plannedLinearChanges,
  readLinearBlockChanges,
} from "../src/workouts/linear-block-advance";
import { buildProgressionOutcome } from "../src/workouts/progression-changes";
import {
  linearLoggedSets,
  linearSetWrite,
  linearSlotOf,
} from "../src/workouts/session-linear-block";

const KG_PER_LB = 0.45359237;
const context = (sessionId: string) => ({
  sessionId,
  finishedAt: "2026-10-05T10:00:00.000Z",
  incrementKg: 2.5,
});
const allDone = (state: LinearPeriodizationState, reps: number[]) =>
  lpStoredSets(state, 2.5).map((set, index) => ({
    set: index + 1,
    reps: reps[index] ?? 0,
    loadKg: set.weight ?? 0,
    completed: true,
  }));

describe("LP rules (ROUT-17)", () => {
  it("prescribes the table's loads on the increment, a tie rounding down", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((step) =>
        lpLoadKg(100, lpStep(step).percentage, 2.5),
      ),
      [62.5, 65, 70, 72.5, 75, 77.5, 80, 85],
    );
    assert.equal(roundToIncrement(101.25, 2.5), 100);
    const pounds =
      lpLoadKg(225 * KG_PER_LB, 0.63, 5 * KG_PER_LB) / KG_PER_LB;
    assert.ok(Math.abs(pounds - 140) < 1e-4);
  });

  it("ends steps 1-4 in a technical AMRAP and holds RIR 1-2 after", () => {
    assert.deepEqual(lpStep(1).sets[2], { rirMin: 0, rirMax: 0, amrap: true });
    assert.deepEqual(lpStep(1).sets[0], { rirMin: 2, rirMax: 3, amrap: false });
    assert.ok(lpStep(5).sets.every((set) => set.rirMin === 1 && set.rirMax === 2));
  });

  it("advances one step only when every working set was ticked", () => {
    const state = startLinearPeriodization(100);
    const partial = allDone(state, [10, 10, 12]).map((set, index) =>
      index === 2 ? { ...set, completed: false } : set,
    );
    assert.equal(advanceLinearPeriodization(state, partial, context("a")), null);
    const next = advanceLinearPeriodization(
      state,
      allDone(state, [10, 10, 12]),
      context("a"),
    );
    assert.equal(next?.step, 2);
    assert.equal(next?.referenceMaxKg, 100);
    assert.deepEqual(next?.samples, []);
  });

  it("finishes after step 8 with the estimate from steps 7 and 8", () => {
    let state: LinearPeriodizationState = startLinearPeriodization(100);
    for (let step = 1; step <= 8; step += 1) {
      state = advanceLinearPeriodization(
        state,
        allDone(state, step >= 7 ? [5, 5, 4] : [10, 10, 12]),
        context(`s${step}`),
      )!;
    }
    assert.equal(state.phase, "FINISHED");
    assert.equal(state.samples.length, 6);
    // 80 × (1 + 6.5/30) and 85 × (1 + 6.5/30 | 5.5/30): median 98.96 → 97.5
    assert.equal(state.estimatedMaxKg, 97.5);
    assert.equal(
      advanceLinearPeriodization(state, allDone(state, [5, 5, 5]), context("x")),
      null,
    );
  });

  it("leaves out sets too far from failure and needs three", () => {
    const samples = [
      { sessionId: "a", step: 7, set: 1, loadKg: 80, reps: 12 },
      { sessionId: "a", step: 7, set: 2, loadKg: 80, reps: 5 },
      { sessionId: "b", step: 8, set: 1, loadKg: 85, reps: 4 },
    ];
    assert.equal(lpEstimate(samples, 2.5).estimatedMaxKg, null);
    assert.equal(lpEstimate(samples, 2.5).sets.length, 2);
  });

  it("pre-selects the next block from the evidence", () => {
    assert.deepEqual(lpRecommendation(100, 110, 2.5).kind, "PROGRESS");
    assert.equal(lpRecommendation(100, 110, 2.5).nextReferenceMaxKg, 105);
    assert.equal(lpRecommendation(100, 103, 2.5).nextReferenceMaxKg, 102.5);
    assert.equal(lpRecommendation(100, 97.5, 2.5).kind, "REPEAT");
    assert.equal(lpRecommendation(100, 95, 2.5).kind, "RESET");
    assert.equal(lpRecommendation(100, 95, 2.5).nextReferenceMaxKg, 95);
    assert.equal(lpRecommendation(100, null, 2.5).kind, "REPEAT");
  });

  it("takes the optional recovery step, then the chosen block", () => {
    const finished: LinearPeriodizationState = {
      ...startLinearPeriodization(100),
      step: 8,
      phase: "FINISHED",
    };
    const recovery = continueLinearPeriodization(finished, {
      referenceMaxKg: 105,
      recovery: true,
    })!;
    assert.equal(recovery.phase, "RECOVERY");
    assert.deepEqual(
      lpStoredSets(recovery, 2.5).map((set) => [set.weight, set.reps]),
      [
        [70, 5],
        [70, 5],
      ],
    );
    const next = advanceLinearPeriodization(
      recovery,
      allDone(recovery, [5, 5]),
      context("r"),
    );
    assert.deepEqual(
      [next?.phase, next?.step, next?.cycle, next?.referenceMaxKg],
      ["BLOCK", 1, 2, 105],
    );
    const skip = continueLinearPeriodization(finished, {
      referenceMaxKg: 100,
      recovery: false,
    });
    assert.deepEqual([skip?.phase, skip?.cycle], ["BLOCK", 2]);
    assert.equal(
      continueLinearPeriodization(startLinearPeriodization(100), {
        referenceMaxKg: 100,
        recovery: false,
      }),
      null,
    );
  });
});

describe("LP routine writes (ROUT-17)", () => {
  const warmUp = {
    setNumber: 1,
    repType: "FIXED" as const,
    reps: 5,
    weight: 40,
    kind: "WARMUP" as const,
  };
  const working = {
    setNumber: 2,
    repType: "FIXED" as const,
    reps: 8,
    weight: 999,
    kind: "WORKING" as const,
  };

  it("leaves any other scheme as it was sent", () => {
    const result = normalizeLinearExercise({
      progressionScheme: "DOUBLE_PROGRESSION",
      linearPeriodization: startLinearPeriodization(100),
      sets: [warmUp, working],
    });
    assert.equal(result.linearPeriodization, null);
    assert.deepEqual(result.sets, [warmUp, working]);
  });

  it("stores the warm-ups first, then the state's working sets", () => {
    const result = normalizeLinearExercise({
      progressionScheme: "LINEAR_PERIODIZATION",
      minWeightIncrement: 2.5,
      linearPeriodization: { ...startLinearPeriodization(100), step: 4 },
      sets: [working, warmUp],
    });
    assert.deepEqual(
      result.sets.map((set) => [set.setNumber, set.kind, set.weight, set.reps]),
      [
        [1, "WARMUP", 40, 5],
        [2, "WORKING", 72.5, null],
        [3, "WORKING", 72.5, null],
        [4, "WORKING", 72.5, null],
      ],
    );
  });

  it("stores three working sets without loads until a reference is set", () => {
    const result = normalizeLinearExercise({
      progressionScheme: "LINEAR_PERIODIZATION",
      linearPeriodization: null,
      sets: [working],
    });
    assert.equal(result.linearPeriodization, null);
    assert.deepEqual(
      result.sets.map((set) => set.weight),
      [null, null, null],
    );
  });

  it("refuses a state it cannot store and too many warm-ups", () => {
    assert.throws(
      () =>
        normalizeLinearExercise({
          progressionScheme: "LINEAR_PERIODIZATION",
          linearPeriodization: { ...startLinearPeriodization(100), step: 9 },
          sets: [],
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        normalizeLinearExercise({
          progressionScheme: "LINEAR_PERIODIZATION",
          linearPeriodization: startLinearPeriodization(0),
          sets: [],
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        normalizeLinearExercise({
          progressionScheme: "LINEAR_PERIODIZATION",
          linearPeriodization: null,
          sets: Array.from({ length: 8 }, (_, i) => ({
            ...warmUp,
            setNumber: i + 1,
          })),
        }),
      BadRequestException,
    );
  });

  it("reads a stored state tolerantly and drops samples outside steps 7-8", () => {
    assert.equal(readLinearState("nope"), null);
    assert.equal(readLinearState({ referenceMaxKg: 100 }), null);
    const state = readLinearState({
      ...startLinearPeriodization(100),
      samples: [
        { sessionId: "a", step: 7, set: 1, loadKg: 80, reps: 5 },
        { sessionId: "a", step: 3, set: 1, loadKg: 70, reps: 9 },
        { step: 8, set: 4, loadKg: 85, reps: 3 },
      ],
    });
    assert.equal(state?.samples.length, 1);
  });

  it("shares an LP exercise without the owner's block or its loads", () => {
    type Exercise = {
      progressionScheme: string;
      linearPeriodization?: unknown;
      sets: Array<{ weight?: number | null }>;
    };
    const setup: { days: Array<{ exercises: Exercise[] }> } = {
      days: [
        {
          exercises: [
            {
              progressionScheme: "LINEAR_PERIODIZATION",
              linearPeriodization: startLinearPeriodization(140),
              sets: [{ weight: 60 }, { weight: 87.5 }],
            },
            {
              progressionScheme: "DOUBLE_PROGRESSION",
              sets: [{ weight: 50 }],
            },
          ],
        },
      ],
    };
    const shared = withoutOwnersBlocks(setup);
    assert.equal(shared.days[0].exercises[0].linearPeriodization, null);
    assert.deepEqual(
      shared.days[0].exercises[0].sets.map((set) => set.weight),
      [null, null],
    );
    assert.equal(shared.days[0].exercises[1].sets[0].weight, 50);
  });
});

const snapshotWith = (
  state: LinearPeriodizationState | null,
  scheme = "LINEAR_PERIODIZATION",
) => ({
  schemaVersion: 1,
  sessionId: "session-1",
  sourceRoutineId: "routine-1",
  sourceRoutineDayId: "day-1",
  capturedAt: "2026-10-05T08:00:00.000Z",
  provenance: "CAPTURED",
  notes: null,
  routine: { id: "routine-1", name: "Strength" },
  routineDay: {
    id: "day-1",
    exercises: [
      {
        id: "slot-1",
        order: 0,
        progressionScheme: scheme,
        minWeightIncrement: 2.5,
        linearPeriodization: state,
        exercise: { id: "squat", name: "Squat", primaryMuscles: [] },
        sets: [
          { id: "w", setNumber: 1, repType: "FIXED", reps: 5, weight: 40, kind: "WARMUP" },
          ...lpStoredSets(state, 2.5).map((set, index) => ({
            id: `s${index}`,
            setNumber: index + 2,
            ...set,
          })),
        ],
      },
    ],
  },
});

describe("LP sessions (ROUT-17)", () => {
  const state = { ...startLinearPeriodization(100), step: 2 };
  const snapshot = snapshotWith(state);
  const slot = linearSlotOf(snapshot, "slot-1")!;

  it("finds the slot's block only on an LP slot with a reference", () => {
    assert.equal(slot.state.step, 2);
    assert.equal(linearSlotOf(snapshotWith(null), "slot-1"), null);
    assert.equal(
      linearSlotOf(snapshotWith(state, "DOUBLE_PROGRESSION"), "slot-1"),
      null,
    );
    assert.equal(linearSlotOf(null, "slot-1"), null);
  });

  it("stores the prescribed load and refuses an extra set or a kind change", () => {
    assert.deepEqual(
      linearSetWrite(slot, { setNumber: 2, weight: 120, isNew: true }),
      { weight: 65 },
    );
    assert.deepEqual(
      linearSetWrite(slot, { setNumber: 1, weight: 45, isNew: true }),
      { weight: 45 },
    );
    const extra = linearSetWrite(slot, { setNumber: 5, isNew: true });
    assert.equal("refusal" in extra && extra.refusal.code, "LINEAR_BLOCK_EXTRA_SET");
    const kind = linearSetWrite(slot, {
      setNumber: 3,
      kind: "DROP",
      isNew: false,
    });
    assert.equal("refusal" in kind && kind.refusal.code, "LINEAR_BLOCK_KIND_FIXED");
  });

  it("numbers the working sets 1-3 and needs reps on a ticked set", () => {
    const logged = linearLoggedSets(slot, [
      { setNumber: 1, reps: 5, isCompleted: true },
      { setNumber: 2, reps: 11, isCompleted: true },
      { setNumber: 3, reps: 0, isCompleted: true },
    ]);
    assert.deepEqual(
      logged.map((set) => [set.set, set.loadKg, set.completed]),
      [
        [1, 65, true],
        [2, 65, false],
        [3, 65, false],
      ],
    );
  });

  const logs = [2, 3, 4].map((setNumber) => ({
    routineExerciseId: "slot-1",
    setNumber,
    reps: 10,
    isCompleted: true,
  }));
  const exercises = snapshot.routineDay.exercises;

  it("moves a slot whose sets were all done, unless swapped or a deload", () => {
    const base = {
      sessionId: "session-1",
      finishedAt: "2026-10-05T10:00:00.000Z",
      runs: true,
      substitutedIds: new Set<string>(),
    };
    const [change] = plannedLinearChanges(snapshot, exercises, logs, base);
    assert.deepEqual([change.before.step, change.after.step], [2, 3]);
    assert.equal(change.exerciseName, "Squat");
    assert.deepEqual(
      plannedLinearChanges(snapshot, exercises, logs, { ...base, runs: false }),
      [],
    );
    assert.deepEqual(
      plannedLinearChanges(snapshot, exercises, logs, {
        ...base,
        substitutedIds: new Set(["slot-1"]),
      }),
      [],
    );
    assert.deepEqual(
      plannedLinearChanges(snapshot, exercises, logs.slice(0, 2), base),
      [],
    );
    assert.equal(
      readLinearBlockChanges(JSON.parse(JSON.stringify([change])))[0].after.step,
      3,
    );
    assert.deepEqual(readLinearBlockChanges([{ before: 1 }]), []);
  });

  it("never lets double progression or the carried weight touch an LP slot", () => {
    const outcome = buildProgressionOutcome(exercises as never, [
      ...logs.map((log) => ({ ...log, weight: 65, kind: "WORKING" as const })),
    ]);
    assert.deepEqual(outcome, { updates: [], changes: [] });
  });
});
