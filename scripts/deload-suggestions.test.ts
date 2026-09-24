import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { TrainingSignalsResponse } from "@sunsteel/contracts";
import { DatabaseService } from "../src/database/database.service";
import {
  chooseSuggestionRoutine,
  deloadStateReason,
  suggestionWindow,
  sustainedEvidence,
  WorkoutDeloadSuggestionService,
} from "../src/workouts/workout-deload-suggestion.service";
import type { WorkoutTrainingSignalsService } from "../src/workouts/workout-training-signals.service";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function signals(marked: {
  effort?: boolean;
  repTargets?: boolean;
  declines?: boolean;
  workouts?: boolean;
}): TrainingSignalsResponse {
  return {
    effort: { marked: Boolean(marked.effort) },
    repTargets: { marked: Boolean(marked.repTargets) },
    declines: { marked: Boolean(marked.declines) },
    workouts: { marked: Boolean(marked.workouts) },
  } as TrainingSignalsResponse;
}

test("a load signal marked today and a week ago is sustained", () => {
  const { evidence, sustained } = sustainedEvidence(
    signals({ effort: true }),
    signals({ effort: true }),
  );
  assert.equal(sustained, true);
  assert.deepEqual(evidence, [
    { signal: "EFFORT", markedNow: true, markedEarlier: true },
    { signal: "REP_TARGETS", markedNow: false, markedEarlier: false },
    { signal: "DECLINES", markedNow: false, markedEarlier: false },
  ]);
});

test("two load signals marked today are enough without the earlier week", () => {
  assert.equal(
    sustainedEvidence(
      signals({ repTargets: true, declines: true }),
      signals({}),
    ).sustained,
    true,
  );
});

test("one signal today only, one signal a week ago only, or workouts are not sustained", () => {
  assert.equal(
    sustainedEvidence(signals({ effort: true }), signals({})).sustained,
    false,
  );
  // Marked a week ago but no longer: the evidence has cleared.
  assert.equal(
    sustainedEvidence(signals({}), signals({ effort: true })).sustained,
    false,
  );
  // Different signals on each date are not one sustained signal.
  assert.equal(
    sustainedEvidence(signals({ effort: true }), signals({ declines: true }))
      .sustained,
    false,
  );
  // Training less never calls for training lighter.
  assert.equal(
    sustainedEvidence(
      signals({ workouts: true, effort: true }),
      signals({ workouts: true }),
    ).sustained,
    false,
  );
});

test("a scheduled or recent deload rules a suggestion out", () => {
  const today = "2026-09-24";
  assert.equal(
    deloadStateReason(
      [{ startDate: "2026-09-30", endDate: "2026-10-06" }],
      today,
    ),
    "DELOAD_SCHEDULED",
  );
  assert.equal(
    deloadStateReason(
      [{ startDate: "2026-09-20", endDate: "2026-09-24" }],
      today,
    ),
    "DELOAD_SCHEDULED",
  );
  assert.equal(
    deloadStateReason(
      [{ startDate: "2026-08-28", endDate: "2026-09-03" }],
      today,
    ),
    "RECENT_DELOAD",
  );
  // 22 days ago is outside the 21-day cooldown.
  assert.equal(
    deloadStateReason(
      [{ startDate: "2026-08-27", endDate: "2026-09-02" }],
      today,
    ),
    null,
  );
  assert.equal(deloadStateReason([], today), null);
});

test("the routine is the active one trained most in 14 days, the latest on a tie", () => {
  const routines = [
    { id: "a", isCompleted: false },
    { id: "b", isCompleted: false },
    { id: "archived", isCompleted: true },
  ];
  const set = (sessionId: string, routineId: string, ago: number) => ({
    sessionId,
    routineId,
    endedAt: daysAgo(ago),
  });
  const rows = [
    set("a1", "a", 2),
    set("a1", "a", 2), // several sets of one workout count once
    set("a2", "a", 9),
    set("b1", "b", 1),
    set("x1", "archived", 1),
    set("x2", "archived", 3),
    set("x3", "archived", 4),
    set("old", "b", 20),
    set("old2", "b", 21),
  ];
  assert.equal(chooseSuggestionRoutine(routines, rows, NOW)?.id, "a");
  assert.equal(
    chooseSuggestionRoutine(
      routines,
      [set("a1", "a", 3), set("b1", "b", 1)],
      NOW,
    )?.id,
    "b",
  );
  assert.equal(
    chooseSuggestionRoutine(routines, [set("old", "a", 15)], NOW),
    null,
  );
});

test("the window starts today or tomorrow and stops at a block boundary", () => {
  assert.deepEqual(suggestionWindow("2026-09-24", false, []), {
    startDate: "2026-09-24",
    endDate: "2026-09-30",
    lengthDays: 7,
    blockName: null,
  });
  assert.deepEqual(
    suggestionWindow("2026-09-24", true, []).startDate,
    "2026-09-25",
  );
  const blocks = [
    {
      id: "b1",
      name: "Autumn",
      startDate: "2026-09-01",
      endDate: "2026-09-27",
    },
  ];
  assert.deepEqual(suggestionWindow("2026-09-24", false, blocks), {
    startDate: "2026-09-24",
    endDate: "2026-09-27",
    lengthDays: 4,
    blockName: "Autumn",
  });
  // Starting before a block, the window stops the day before it begins.
  assert.deepEqual(
    suggestionWindow("2026-09-24", false, [
      {
        id: "b2",
        name: "Peak",
        startDate: "2026-09-27",
        endDate: "2026-10-20",
      },
    ]),
    {
      startDate: "2026-09-24",
      endDate: "2026-09-26",
      lengthDays: 3,
      blockName: null,
    },
  );
});

function service({
  deloads = [] as { startDate: string; endDate: string }[],
  routine = {
    id: "upper-lower",
    name: "Upper / Lower",
    scheduleMode: "WEEKLY",
    isCompleted: false,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    restDays: [0],
    rotationWeekdays: [],
    days: [{ dayOfWeek: 1 }, { dayOfWeek: 4 }],
    trainingBlocks: [],
    temporaryOverrides: [],
  },
  todaySessions = [] as { startedAt: Date }[],
}) {
  const calls: string[] = [];
  const db = {
    user: { findUnique: async () => ({ timeZone: "UTC" }) },
    routineTemporaryOverride: {
      findMany: async () => {
        calls.push("deloads");
        return deloads;
      },
    },
    routine: { findMany: async () => [routine] },
    workoutSession: { findMany: async () => todaySessions },
    scheduleOverride: { findMany: async () => [] },
  } as unknown as DatabaseService;
  const trainingSignals = {
    readInputs: async (_userId: string, from: Date, to: Date) => {
      calls.push(`inputs ${from.toISOString()} ${to.toISOString()}`);
      return {
        rows: [
          {
            sessionId: "s1",
            routineId: "upper-lower",
            endedAt: daysAgo(2),
          },
        ],
        floors: new Map(),
      };
    },
  } as unknown as WorkoutTrainingSignalsService;
  const instance = new WorkoutDeloadSuggestionService(db, trainingSignals);
  return { instance, calls };
}

test("sustained evidence suggests the routine's default deload over a planned week", async () => {
  const { instance, calls } = service({});
  const result = await instance.getDeloadSuggestion(
    "user-1",
    NOW,
    (_rows, _floors, at) =>
      at.getTime() === NOW.getTime()
        ? signals({ effort: true, repTargets: true })
        : signals({}),
  );
  // One read covers both evaluations: 28 days before a week ago, to now.
  assert.equal(
    calls[0],
    `inputs ${daysAgo(35).toISOString()} ${NOW.toISOString()}`,
  );
  assert.equal(result.unavailable, null);
  assert.deepEqual(result.suggestion, {
    routineId: "upper-lower",
    routineName: "Upper / Lower",
    startDate: "2026-09-24",
    endDate: "2026-09-30",
    lengthDays: 7,
    loadReductionPercent: 10,
    setMode: "HALF",
    trainingBlockName: null,
  });
  assert.deepEqual(result.thresholds, {
    earlierDays: 7,
    minMarkedToday: 2,
    cooldownDays: 21,
    routineDays: 14,
    lengthDays: 7,
  });
});

test("nothing is suggested when the evidence is not sustained, and the plan is not read", async () => {
  const { instance, calls } = service({});
  // Effort marked today only: one signal, not seen a week ago.
  const result = await instance.getDeloadSuggestion(
    "user-1",
    NOW,
    (_rows, _floors, at) =>
      at.getTime() === NOW.getTime() ? signals({ effort: true }) : signals({}),
  );
  assert.equal(result.unavailable, "NOT_SUSTAINED");
  assert.equal(result.suggestion, null);
  assert.equal(calls.includes("deloads"), false);
});

test("a planned deload, a routine trained today and an unplanned week each change the answer", async () => {
  const both = () => signals({ effort: true, repTargets: true });
  assert.equal(
    (
      await service({
        deloads: [{ startDate: "2026-09-28", endDate: "2026-10-04" }],
      }).instance.getDeloadSuggestion("user-1", NOW, both)
    ).unavailable,
    "DELOAD_SCHEDULED",
  );
  assert.equal(
    (
      await service({
        todaySessions: [{ startedAt: new Date("2026-09-24T08:00:00Z") }],
      }).instance.getDeloadSuggestion("user-1", NOW, both)
    ).suggestion?.startDate,
    "2026-09-25",
  );
  const restWeek = await service({
    routine: {
      id: "upper-lower",
      name: "Upper / Lower",
      scheduleMode: "WEEKLY",
      isCompleted: false,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      restDays: [],
      rotationWeekdays: [],
      days: [],
      trainingBlocks: [],
      temporaryOverrides: [],
    },
  }).instance.getDeloadSuggestion("user-1", NOW, both);
  assert.equal(restWeek.unavailable, "NOTHING_PLANNED");
  assert.equal(restWeek.suggestion, null);
});
