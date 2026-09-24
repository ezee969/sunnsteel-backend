import * as assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseService } from "../src/database/database.service";
import type { ReminderRoutine } from "../src/notifications/push/training-days";
import {
  buildBlockComparison,
  compareLifts,
  comparisonPeriods,
  countPlannedWorkouts,
  summarizePeriod,
  WorkoutBlockComparisonService,
} from "../src/workouts/workout-block-comparison.service";
import type {
  TrainingSignalSetRow,
  WorkoutTrainingSignalsService,
} from "../src/workouts/workout-training-signals.service";

const block = (
  seriesId: string,
  startDate: string,
  endDate: string,
  name = seriesId,
) => ({ seriesId, name, startDate, endDate });

test("a finished block is compared with the whole block before it", () => {
  const periods = comparisonPeriods(
    [
      block("autumn", "2026-09-01", "2026-09-28"),
      block("summer", "2026-07-01", "2026-08-11"),
    ],
    "autumn",
    "2026-10-05",
  );
  assert.equal(periods.isRunning, false);
  assert.deepEqual(periods.current, {
    kind: "TRAINING_BLOCK",
    name: "autumn",
    seriesId: "autumn",
    startDate: "2026-09-01",
    endDate: "2026-09-28",
  });
  assert.deepEqual(periods.previous, {
    kind: "TRAINING_BLOCK",
    name: "summer",
    seriesId: "summer",
    startDate: "2026-07-01",
    endDate: "2026-08-11",
  });
});

test("a running block stops at today and cuts the earlier block to the same days", () => {
  const periods = comparisonPeriods(
    [
      block("summer", "2026-07-01", "2026-08-11"),
      block("autumn", "2026-09-01", "2026-09-28"),
    ],
    "autumn",
    "2026-09-10",
  );
  assert.equal(periods.isRunning, true);
  assert.equal(periods.current.endDate, "2026-09-10");
  assert.deepEqual(
    [periods.previous.startDate, periods.previous.endDate],
    ["2026-07-01", "2026-07-10"],
  );
});

test("the first block is compared with the same number of days before it", () => {
  const periods = comparisonPeriods(
    [block("autumn", "2026-09-01", "2026-09-28")],
    "autumn",
    "2026-10-05",
  );
  assert.deepEqual(periods.previous, {
    kind: "BEFORE_BLOCK",
    name: null,
    seriesId: null,
    startDate: "2026-08-04",
    endDate: "2026-08-31",
  });
});

test("a block that has not started, or an unknown one, is refused", () => {
  assert.throws(
    () =>
      comparisonPeriods(
        [block("peak", "2026-10-01", "2026-10-20")],
        "peak",
        "2026-09-24",
      ),
    /has not started/,
  );
  assert.throws(
    () => comparisonPeriods([], "missing", "2026-09-24"),
    /Training block not found/,
  );
});

test("a period longer than a year keeps its latest 365 days", () => {
  const periods = comparisonPeriods(
    [block("long", "2024-01-01", "2026-06-30")],
    "long",
    "2026-09-24",
  );
  assert.equal(periods.truncated, true);
  assert.equal(periods.current.startDate, "2025-07-01");
});

const weekly = (overrides: Partial<ReminderRoutine> = {}): ReminderRoutine => ({
  id: "r",
  name: "Upper / Lower",
  scheduleMode: "WEEKLY",
  isCompleted: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  days: [{ dayOfWeek: 1 }, { dayOfWeek: 4 }],
  restDays: [],
  rotationWeekdays: [],
  trainingBlocks: [],
  temporaryOverrides: [],
  ...overrides,
});

test("planned workouts follow the plan up to today, with moves and skips", () => {
  const range = {
    kind: "TRAINING_BLOCK" as const,
    name: "b",
    seriesId: "b",
    startDate: "2026-09-07",
    endDate: "2026-09-20",
  };
  // Mondays and Thursdays: 7, 10, 14, 17 -- four planned days.
  assert.equal(countPlannedWorkouts(weekly(), [], range, "2026-09-24"), 4);
  // Only up to today.
  assert.equal(countPlannedWorkouts(weekly(), [], range, "2026-09-12"), 2);
  // A skipped Thursday is not planned.
  assert.equal(
    countPlannedWorkouts(
      weekly(),
      [{ routineId: "r", kind: "SKIP", date: "2026-09-10", toDate: null }],
      range,
      "2026-09-24",
    ),
    3,
  );
  // A rotation without training weekdays has no dated plan.
  assert.equal(
    countPlannedWorkouts(
      weekly({ scheduleMode: "ROTATION", days: [{ dayOfWeek: null }] }),
      [],
      range,
      "2026-09-24",
    ),
    null,
  );
});

const row = (
  overrides: Partial<TrainingSignalSetRow> & { endedAt: Date },
): TrainingSignalSetRow => ({
  sessionId: "s",
  routineId: "r",
  status: "COMPLETED",
  isDeload: false,
  exerciseId: "bench",
  exerciseName: "Bench Press",
  slotId: "slot",
  setNumber: 1,
  reps: 5,
  weight: 100,
  rpe: null,
  ...overrides,
});
const at = (date: string) => new Date(`${date}T18:00:00.000Z`);

test("lifts trained in both periods are compared by their best estimated 1RM", () => {
  const lifts = compareLifts(
    [
      row({ endedAt: at("2026-09-10"), weight: 105 }),
      row({ endedAt: at("2026-09-12"), weight: 100 }),
      row({
        endedAt: at("2026-09-10"),
        exerciseId: "curl",
        exerciseName: "Curl",
        weight: 20,
      }),
      // A deload set never sets the best.
      row({ endedAt: at("2026-09-14"), weight: 140, isDeload: true }),
    ],
    [
      row({ endedAt: at("2026-08-10"), weight: 100 }),
      row({
        endedAt: at("2026-08-10"),
        exerciseId: "squat",
        exerciseName: "Squat",
      }),
    ],
  );
  assert.deepEqual(lifts, [
    {
      exerciseId: "bench",
      exerciseName: "Bench Press",
      current: { estimated1rmKg: 122.5, weightKg: 105, reps: 5 },
      previous: { estimated1rmKg: 116.7, weightKg: 100, reps: 5 },
      changeKg: 5.8,
      changePercent: 5,
    },
  ]);
});

test("a period counts workouts, early ends, deloads, sets and load, also per week", () => {
  const summary = summarizePeriod(
    [
      row({ endedAt: at("2026-09-01"), sessionId: "a" }),
      row({ endedAt: at("2026-09-01"), sessionId: "a", setNumber: 2 }),
      row({
        endedAt: at("2026-09-03"),
        sessionId: "b",
        status: "ABORTED",
        weight: 0,
      }),
      row({
        endedAt: at("2026-09-05"),
        sessionId: "c",
        isDeload: true,
        weight: 50,
      }),
    ],
    {
      kind: "TRAINING_BLOCK",
      name: "b",
      seriesId: "b",
      startDate: "2026-09-01",
      endDate: "2026-09-14",
    },
    6,
  );
  assert.equal(summary.days, 14);
  assert.equal(summary.plannedWorkouts, 6);
  assert.equal(summary.workouts, 3);
  assert.equal(summary.endedEarly, 1);
  assert.equal(summary.deloads, 1);
  assert.equal(summary.completedSets, 4);
  assert.equal(summary.volumeKg, 1250);
  assert.deepEqual(summary.perWeek, {
    workouts: 1.5,
    completedSets: 2,
    volumeKg: 625,
  });
});

test("rows are placed by their local date, and deloads stay out of effort and rep targets", () => {
  const periods = comparisonPeriods(
    [block("autumn", "2026-09-01", "2026-09-14")],
    "autumn",
    "2026-09-24",
  );
  const rated = (
    date: string,
    rpe: number,
    sessionId: string,
    deload = false,
  ) =>
    Array.from({ length: 10 }, (_, index) =>
      row({
        endedAt: at(date),
        rpe,
        sessionId,
        setNumber: index + 1,
        isDeload: deload,
        reps: index < 2 ? 3 : 5,
      }),
    );
  const rows = [
    ...rated("2026-09-05", 8, "now"),
    ...rated("2026-09-06", 5, "deload", true),
    ...rated("2026-08-25", 7, "before"),
    // Outside both periods.
    ...rated("2026-08-01", 1, "old"),
  ];
  const floors = new Map(
    ["now", "deload", "before", "old"].map((id) => [
      id,
      new Map(
        Array.from({ length: 10 }, (_, index) => [`slot:${index + 1}`, 5]),
      ),
    ]),
  );
  const result = buildBlockComparison({
    routineId: "r",
    today: "2026-09-24",
    periods,
    rows,
    floors,
    localDateOf: (date) => date.toISOString().slice(0, 10),
    planned: { current: 4, previous: 4 },
  });
  assert.equal(result.current.workouts, 2);
  assert.equal(result.current.deloads, 1);
  assert.equal(result.previous.workouts, 1);
  assert.deepEqual(result.effort.comparison, {
    recent: { averageRpe: 8, sets: 10 },
    previous: { averageRpe: 7, sets: 10 },
    difference: 1,
    lifts: 1,
  });
  assert.deepEqual(result.current.repTargets, {
    shortSets: 2,
    targetedSets: 10,
    shortPercent: 20,
  });
  assert.equal(result.lifts.length, 1);
});

test("another member's routine answers 404", async () => {
  const db = {
    routine: { findFirst: async () => null },
  } as unknown as DatabaseService;
  const service = new WorkoutBlockComparisonService(
    db,
    {} as WorkoutTrainingSignalsService,
  );
  await assert.rejects(
    service.compare("user-1", "someone-elses", "autumn"),
    /Routine not found/,
  );
});
