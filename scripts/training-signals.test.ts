import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  TRAINING_SIGNAL_MIN_RPE_SETS,
  TRAINING_SIGNAL_MIN_TARGET_SETS,
  TRAINING_SIGNAL_PERIOD_DAYS,
} from "@sunsteel/contracts";
import { DatabaseService } from "../src/database/database.service";
import {
  evaluateTrainingSignals,
  type RepTargetFloors,
  repTargetFloors,
  type TrainingSignalSetRow,
  WorkoutTrainingSignalsService,
} from "../src/workouts/workout-training-signals.service";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const NO_FLOORS: RepTargetFloors = new Map();

function set(
  overrides: Partial<TrainingSignalSetRow> & { daysAgo: number },
): TrainingSignalSetRow {
  const { daysAgo: ago, ...rest } = overrides;
  return {
    sessionId: `s-${ago}`,
    status: "COMPLETED",
    endedAt: daysAgo(ago),
    isDeload: false,
    exerciseId: "bench",
    exerciseName: "Bench Press",
    slotId: "slot-bench",
    setNumber: 1,
    reps: 5,
    weight: 100,
    rpe: null,
    ...rest,
  };
}

/** `count` sets of one lift at one RPE, spread over one session. */
function rated(ago: number, rpe: number, count: number, exerciseId = "bench") {
  return Array.from({ length: count }, (_, index) =>
    set({ daysAgo: ago, rpe, exerciseId, setNumber: index + 1 }),
  );
}

test("the two halves are the last period and the one before, by end time", () => {
  const signals = evaluateTrainingSignals(
    [
      set({ daysAgo: 0 }),
      set({ daysAgo: TRAINING_SIGNAL_PERIOD_DAYS }),
      set({ daysAgo: 2 * TRAINING_SIGNAL_PERIOD_DAYS }),
      set({ daysAgo: -1 }),
    ],
    NO_FLOORS,
    NOW,
  );
  // Exactly 14 days ago is the previous half; exactly 28 is outside; the
  // future is ignored.
  assert.equal(signals.workouts.recent.workouts, 1);
  assert.equal(signals.workouts.previous.workouts, 1);
  assert.equal(signals.periods.recent.from, daysAgo(14).toISOString());
  assert.equal(signals.periods.previous.from, daysAgo(28).toISOString());
  assert.equal(signals.thresholds.periodDays, TRAINING_SIGNAL_PERIOD_DAYS);
});

test("effort compares average RPE only on lifts rated in both halves", () => {
  const signals = evaluateTrainingSignals(
    [
      ...rated(2, 8.5, 6),
      ...rated(5, 8.3, 6),
      ...rated(18, 7.8, 12),
      // Rated only in the last half: a new lift cannot move the average.
      ...rated(3, 10, 8, "squat"),
    ],
    NO_FLOORS,
    NOW,
  );
  assert.deepEqual(signals.effort.comparison, {
    recent: { averageRpe: 8.4, sets: 12 },
    previous: { averageRpe: 7.8, sets: 12 },
    difference: 0.6,
    lifts: 1,
  });
  assert.equal(signals.effort.marked, true);
});

test("effort is marked from a rise of exactly the threshold, not below", () => {
  const exact = evaluateTrainingSignals(
    [...rated(2, 8.3, 10), ...rated(20, 7.8, 10)],
    NO_FLOORS,
    NOW,
  );
  assert.equal(exact.effort.comparison?.difference, 0.5);
  assert.equal(exact.effort.marked, true);
  const below = evaluateTrainingSignals(
    [...rated(2, 8.2, 10), ...rated(20, 7.8, 10)],
    NO_FLOORS,
    NOW,
  );
  assert.equal(below.effort.marked, false);
  const fell = evaluateTrainingSignals(
    [...rated(2, 7, 10), ...rated(20, 8, 10)],
    NO_FLOORS,
    NOW,
  );
  assert.equal(fell.effort.comparison?.difference, -1);
  assert.equal(fell.effort.marked, false);
});

test("effort needs the minimum RPE sets in each half and says how many it has", () => {
  const signals = evaluateTrainingSignals(
    [
      ...rated(2, 9, TRAINING_SIGNAL_MIN_RPE_SETS),
      ...rated(20, 7, TRAINING_SIGNAL_MIN_RPE_SETS - 1),
    ],
    NO_FLOORS,
    NOW,
  );
  assert.equal(signals.effort.comparison, null);
  assert.equal(signals.effort.recentSets, TRAINING_SIGNAL_MIN_RPE_SETS);
  assert.equal(signals.effort.previousSets, TRAINING_SIGNAL_MIN_RPE_SETS - 1);
  assert.equal(signals.effort.marked, false);
});

test("deload workouts are left out of effort, targets and declines but counted as workouts", () => {
  const signals = evaluateTrainingSignals(
    [
      ...rated(2, 6, 10).map((row) => ({ ...row, isDeload: true })),
      ...rated(20, 8, 10),
    ],
    NO_FLOORS,
    NOW,
  );
  assert.equal(signals.effort.recentSets, 0);
  assert.deepEqual(signals.workouts.recent, {
    workouts: 1,
    endedEarly: 0,
    deloads: 1,
  });
});

test("rep-target floors come from the snapshot: a fixed target's reps, a range's minimum", () => {
  const floors = repTargetFloors({
    routineDay: {
      id: "day",
      exercises: [
        {
          id: "slot-bench",
          order: 0,
          progressionScheme: "NONE",
          minWeightIncrement: 2.5,
          exercise: { id: "bench", name: "Bench Press", primaryMuscles: [] },
          sets: [
            { id: "a", setNumber: 1, repType: "FIXED", reps: 5 },
            {
              id: "b",
              setNumber: 2,
              repType: "RANGE",
              minReps: 8,
              maxReps: 12,
            },
            { id: "c", setNumber: 3, repType: "RANGE", minReps: null },
          ],
        },
      ],
    },
  });
  assert.deepEqual(
    [...floors],
    [
      ["slot-bench:1", 5],
      ["slot-bench:2", 8],
    ],
  );
});

test("rep targets count completed sets below the floor, and only sets with a target", () => {
  const floors: RepTargetFloors = new Map(
    [2, 20].map((ago) => [
      `s-${ago}`,
      new Map(
        Array.from({ length: 10 }, (_, index) => [
          `slot-bench:${index + 1}`,
          8,
        ]),
      ),
    ]),
  );
  const rows = [
    // Last half: 4 of 10 short (Bench Press 3, Squat 1 via a swapped slot).
    ...Array.from({ length: 10 }, (_, index) =>
      set({
        daysAgo: 2,
        setNumber: index + 1,
        reps: index < 4 ? 6 : 8,
        exerciseId: index === 3 ? "squat" : "bench",
        exerciseName: index === 3 ? "Back Squat" : "Bench Press",
      }),
    ),
    // A set beyond the prescription has no target.
    set({ daysAgo: 2, setNumber: 11, reps: 1 }),
    // Before: 1 of 10 short.
    ...Array.from({ length: 10 }, (_, index) =>
      set({ daysAgo: 20, setNumber: index + 1, reps: index === 0 ? 7 : 9 }),
    ),
  ];
  const signals = evaluateTrainingSignals(rows, floors, NOW);
  assert.deepEqual(signals.repTargets.recent, {
    shortSets: 4,
    targetedSets: 10,
    shortPercent: 40,
  });
  assert.deepEqual(signals.repTargets.previous, {
    shortSets: 1,
    targetedSets: 10,
    shortPercent: 10,
  });
  assert.equal(signals.repTargets.comparable, true);
  assert.equal(signals.repTargets.marked, true);
  assert.deepEqual(signals.repTargets.mostOften, [
    { exerciseId: "bench", exerciseName: "Bench Press", shortSets: 3 },
    { exerciseId: "squat", exerciseName: "Back Squat", shortSets: 1 },
  ]);
});

test("rep targets are not marked without enough sets, or with fewer short sets than the minimum", () => {
  const floors: RepTargetFloors = new Map([
    [
      "s-2",
      new Map([
        ["slot-bench:1", 8],
        ["slot-bench:2", 8],
      ]),
    ],
  ]);
  const signals = evaluateTrainingSignals(
    [
      set({ daysAgo: 2, setNumber: 1, reps: 5 }),
      set({ daysAgo: 2, setNumber: 2, reps: 5 }),
    ],
    floors,
    NOW,
  );
  assert.equal(signals.repTargets.recent.shortPercent, 100);
  assert.equal(signals.repTargets.comparable, false);
  assert.equal(signals.repTargets.marked, false);
  assert.ok(TRAINING_SIGNAL_MIN_TARGET_SETS > 2);
});

function session(
  ago: number,
  weight: number,
  reps: number,
  exerciseId = "bench",
) {
  return set({
    daysAgo: ago,
    sessionId: `${exerciseId}-${ago}`,
    weight,
    reps,
    exerciseId,
    exerciseName: exerciseId,
  });
}

test("a lift is listed when its best estimated 1RM fell in each of its last two sessions", () => {
  const signals = evaluateTrainingSignals(
    [
      session(25, 110, 5), // older than the last three: ignored
      session(10, 100, 5),
      set({ daysAgo: 10, sessionId: "bench-10", weight: 60, reps: 10 }),
      session(6, 97.5, 5),
      session(2, 95, 5),
    ],
    NO_FLOORS,
    NOW,
  );
  assert.equal(signals.declines.checkedLifts, 1);
  assert.equal(signals.declines.marked, true);
  const [lift] = signals.declines.lifts;
  assert.deepEqual(
    lift.sessions.map((entry) => [
      entry.estimated1rmKg,
      entry.weightKg,
      entry.reps,
    ]),
    [
      [116.7, 100, 5],
      [113.8, 97.5, 5],
      [110.8, 95, 5],
    ],
  );
  assert.equal(lift.declineRatio, 0.051);
});

test("a lift is not listed when it held once, fell too little, or lacks sessions", () => {
  const signals = evaluateTrainingSignals(
    [
      // Held in the middle.
      session(10, 100, 5, "held"),
      session(6, 100, 5, "held"),
      session(2, 95, 5, "held"),
      // Fell twice by under 2.5% in total.
      session(10, 100, 5, "small"),
      session(6, 99.5, 5, "small"),
      session(2, 99, 5, "small"),
      // Two sessions only.
      session(6, 100, 5, "short"),
      session(2, 80, 5, "short"),
      // Bodyweight sets carry no estimated 1RM.
      session(10, 0, 20, "dips"),
      session(6, 0, 15, "dips"),
      session(2, 0, 10, "dips"),
    ],
    NO_FLOORS,
    NOW,
  );
  assert.equal(signals.declines.checkedLifts, 2);
  assert.deepEqual(signals.declines.lifts, []);
  assert.equal(signals.declines.marked, false);
});

test("workouts are marked for two fewer or more ended early, never for one fewer", () => {
  const workouts = (recent: number, previous: number, endedEarly = [0, 0]) =>
    evaluateTrainingSignals(
      [
        ...Array.from({ length: recent }, (_, index) =>
          set({
            daysAgo: index + 1,
            status: index < endedEarly[0] ? "ABORTED" : "COMPLETED",
          }),
        ),
        ...Array.from({ length: previous }, (_, index) =>
          set({
            daysAgo: index + 15,
            status: index < endedEarly[1] ? "ABORTED" : "COMPLETED",
          }),
        ),
      ],
      NO_FLOORS,
      NOW,
    ).workouts;
  assert.equal(workouts(4, 5).marked, false);
  assert.equal(workouts(3, 5).marked, true);
  assert.equal(workouts(5, 5, [1, 0]).marked, true);
  assert.equal(workouts(5, 5, [1, 1]).marked, false);
  assert.deepEqual(workouts(5, 5, [1, 0]).recent, {
    workouts: 5,
    endedEarly: 1,
    deloads: 0,
  });
});

test("the read is bounded to the owner's workouts in the two periods and their snapshots", async () => {
  const queries: string[] = [];
  let snapshotWhere: unknown;
  const db = {
    $queryRaw: async (sql: {
      strings: readonly string[];
      values: unknown[];
    }) => {
      queries.push(sql.strings.join("?"));
      assert.deepEqual(sql.values, ["user-1", daysAgo(28), NOW]);
      return [set({ daysAgo: 2, sessionId: "s-1", reps: 4 })];
    },
    workoutSessionSnapshot: {
      findMany: async (args: { where: unknown }) => {
        snapshotWhere = args.where;
        return [
          {
            sessionId: "s-1",
            payload: {
              routineDay: {
                exercises: [
                  {
                    id: "slot-bench",
                    sets: [{ setNumber: 1, repType: "FIXED", reps: 5 }],
                  },
                ],
              },
            },
          },
        ];
      },
    },
  } as unknown as DatabaseService;
  const signals = await new WorkoutTrainingSignalsService(
    db,
  ).getTrainingSignals("user-1", NOW);
  assert.match(queries[0], /"status" IN \('COMPLETED', 'ABORTED'\)/);
  assert.match(queries[0], /logs\."isCompleted"/);
  assert.deepEqual(snapshotWhere, { sessionId: { in: ["s-1"] } });
  assert.deepEqual(signals.repTargets.recent, {
    shortSets: 1,
    targetedSets: 1,
    shortPercent: 100,
  });
});
