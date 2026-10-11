import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  LOGGED_WORKOUT_LOOKBACK_DAYS,
  LOGGED_WORKOUT_MAX_DURATION_SEC,
  canLogWorkoutOn,
  loggedWorkoutDateRange,
  sessionCorrectionWindow,
  startLinearPeriodization,
} from "@sunsteel/contracts";

import {
  localTimeToInstant,
  loggedBlockSteps,
  loggedSetRows,
  loggedWorkoutConflict,
  loggedWorkoutTimes,
  rewindLoggedDay,
  type LoggedDaySlot,
} from "../src/workouts/logged-workout-rules";
import { notFromSessions } from "../src/workouts/logged-sessions";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    const response = (error as BadRequestException).getResponse() as {
      code?: string;
    };
    return response.code;
  }
  return null;
};

describe("the dates a past workout can be logged on (LIVE-23)", () => {
  it("runs from the lookback to the day before the routine was created", () => {
    const range = loggedWorkoutDateRange({
      today: "2026-10-11",
      createdOn: "2026-10-09",
    });
    assert.deepEqual(range, { first: "2026-07-19", last: "2026-10-08" });
    const input = { today: "2026-10-11", createdOn: "2026-10-09" };
    assert.equal(canLogWorkoutOn("2026-10-08", input), true);
    assert.equal(canLogWorkoutOn("2026-07-19", input), true);
    assert.equal(canLogWorkoutOn("2026-10-09", input), false);
    assert.equal(canLogWorkoutOn("2026-07-18", input), false);
    assert.equal(canLogWorkoutOn("2026-02-30", input), false);
    assert.equal(canLogWorkoutOn("yesterday", input), false);
  });

  it("has none for a routine created at the edge of the lookback", () => {
    assert.equal(
      loggedWorkoutDateRange({ today: "2026-10-11", createdOn: "2026-07-19" }),
      null,
    );
  });
});

describe("when a logged workout happened", () => {
  const base = {
    date: "2026-10-05",
    estimateSec: 3600,
    timeZone: "Europe/Madrid",
    routineCreatedAt: new Date("2026-10-09T18:00:00Z"),
    now: new Date("2026-10-11T10:00:00Z"),
  };

  it("maps a local time in the member's zone back to the instant", () => {
    // Madrid is UTC+2 in summer time and UTC+1 after 25 October.
    assert.equal(
      localTimeToInstant("2026-10-05", 12 * 60, "Europe/Madrid").toISOString(),
      "2026-10-05T10:00:00.000Z",
    );
    assert.equal(
      localTimeToInstant("2026-11-05", 12 * 60, "Europe/Madrid").toISOString(),
      "2026-11-05T11:00:00.000Z",
    );
    assert.equal(
      localTimeToInstant("2026-10-05", 0, "UTC").toISOString(),
      "2026-10-05T00:00:00.000Z",
    );
    // A minute the spring change skips lands next to it, never on another day.
    const skipped = localTimeToInstant("2026-03-29", 2 * 60 + 30, "Europe/Madrid");
    assert.ok(
      skipped.toISOString().startsWith("2026-03-29T0"),
      skipped.toISOString(),
    );
  });

  it("starts at noon for the day's estimate unless told otherwise", () => {
    const times = loggedWorkoutTimes(base);
    assert.equal(times.startedAt.toISOString(), "2026-10-05T10:00:00.000Z");
    assert.equal(times.endedAt.toISOString(), "2026-10-05T11:00:00.000Z");
    assert.equal(times.durationSec, 3600);
    assert.equal(times.dayFrom.toISOString(), "2026-10-04T22:00:00.000Z");
    assert.equal(times.dayTo.toISOString(), "2026-10-05T22:00:00.000Z");
    const late = loggedWorkoutTimes({
      ...base,
      startMinute: 18 * 60 + 30,
      durationSec: 99_999,
    });
    assert.equal(late.startedAt.toISOString(), "2026-10-05T16:30:00.000Z");
    assert.equal(late.durationSec, LOGGED_WORKOUT_MAX_DURATION_SEC);
  });

  it("refuses a date on or after the routine's creation or past the lookback", () => {
    for (const date of ["2026-10-09", "2026-10-10", "2026-07-18"]) {
      assert.equal(
        codeOf(() => loggedWorkoutTimes({ ...base, date })),
        "LOGGED_WORKOUT_DATE",
      );
    }
    // Created at 02:00 local on the 9th: a workout late on the 8th that runs
    // past it never happened before the routine existed.
    assert.equal(
      codeOf(() =>
        loggedWorkoutTimes({
          ...base,
          date: "2026-10-08",
          startMinute: 23 * 60,
          durationSec: LOGGED_WORKOUT_MAX_DURATION_SEC,
          routineCreatedAt: new Date("2026-10-09T00:00:00Z"),
        }),
      ),
      "LOGGED_WORKOUT_DATE",
    );
    assert.equal(LOGGED_WORKOUT_LOOKBACK_DAYS, 84);
  });

  it("names its conflicts with their codes", () => {
    const error = loggedWorkoutConflict("LOGGED_WORKOUT_LIMIT", { max: 48 });
    assert.ok(error instanceof ConflictException);
    assert.equal(
      (error.getResponse() as { code: string }).code,
      "LOGGED_WORKOUT_LIMIT",
    );
  });
});

describe("the sets a logged workout stores", () => {
  const slots: LoggedDaySlot[] = [
    {
      id: "re-squat",
      exerciseId: "squat",
      progressionScheme: "DOUBLE_PROGRESSION",
      linearPeriodization: null,
      sets: [
        { setNumber: 1, kind: "WARMUP" },
        { setNumber: 2, kind: "WORKING" },
        { setNumber: 3, kind: "WORKING" },
      ],
    },
  ];
  const set = (setNumber: number, values = {}) => ({
    routineExerciseId: "re-squat",
    setNumber,
    reps: 5,
    weight: 100,
    isCompleted: true,
    ...values,
  });

  it("keeps each set's prescription kind and its exercise", () => {
    const rows = loggedSetRows(slots, [set(1, { weight: 60 }), set(2), set(3)]);
    assert.deepEqual(
      rows.map((row) => [row.setNumber, row.kind, row.exerciseId]),
      [
        [1, "WARMUP", "squat"],
        [2, "WORKING", "squat"],
        [3, "WORKING", "squat"],
      ],
    );
    const [extra] = loggedSetRows(slots, [set(4)]);
    assert.equal(extra.kind, "WORKING");
  });

  it("refuses a set outside the day, twice or after a gap", () => {
    assert.equal(
      codeOf(() =>
        loggedSetRows(slots, [{ ...set(2), routineExerciseId: "other" }]),
      ),
      "LOGGED_WORKOUT_SET_NOT_IN_DAY",
    );
    assert.equal(
      codeOf(() => loggedSetRows(slots, [set(2), set(2)])),
      "LOGGED_WORKOUT_SET_NOT_IN_DAY",
    );
    assert.equal(
      codeOf(() => loggedSetRows(slots, [set(2), set(5)])),
      "EXTRA_SET_NOT_NEXT",
    );
    assert.equal(codeOf(() => loggedSetRows(slots, [set(14)])), "EXTRA_SETS_MAX");
  });

  it("needs a completed set and holds the correction bounds", () => {
    assert.equal(
      codeOf(() => loggedSetRows(slots, [set(2, { isCompleted: false })])),
      "LOGGED_WORKOUT_NO_SETS",
    );
    assert.equal(
      codeOf(() => loggedSetRows(slots, [set(2, { weight: -1 })])),
      "CORRECTION_WEIGHT_RANGE",
    );
    assert.equal(
      codeOf(() => loggedSetRows(slots, [set(2, { reps: 2.5 })])),
      "CORRECTION_REPS_RANGE",
    );
  });
});

describe("an 8-week slot in a logged workout", () => {
  const block = { ...startLinearPeriodization(100), step: 3 };
  const lpSlot: LoggedDaySlot = {
    id: "re-bench",
    exerciseId: "bench",
    progressionScheme: "LINEAR_PERIODIZATION",
    linearPeriodization: block,
    sets: [],
  };
  const plain: LoggedDaySlot = {
    id: "re-row",
    exerciseId: "row",
    progressionScheme: "NONE",
    linearPeriodization: null,
    sets: [],
  };

  it("trained the week before the slot's own unless the member names one", () => {
    assert.deepEqual([...loggedBlockSteps([lpSlot, plain])], [["re-bench", 2]]);
    assert.deepEqual(
      [
        ...loggedBlockSteps([lpSlot], [
          { routineExerciseId: "re-bench", step: 1 },
        ]),
      ],
      [["re-bench", 1]],
    );
    const first = { ...lpSlot, linearPeriodization: startLinearPeriodization(100) };
    assert.deepEqual([...loggedBlockSteps([first])], [["re-bench", 1]]);
    assert.equal(
      codeOf(() =>
        loggedBlockSteps([lpSlot], [{ routineExerciseId: "re-bench", step: 9 }]),
      ),
      "LINEAR_BLOCK_INVALID",
    );
  });

  it("is recorded at that week's load, warm-ups and other slots untouched", () => {
    const day = {
      exercises: [
        {
          id: "re-bench",
          minWeightIncrement: 2.5,
          linearPeriodization: block,
          sets: [
            { setNumber: 1, weight: 40, kind: "WARMUP" as const },
            { setNumber: 2, weight: 70, kind: "WORKING" as const },
            { setNumber: 3, weight: 70, kind: "WORKING" as const },
            { setNumber: 4, weight: 70, kind: "WORKING" as const },
          ],
        },
        {
          id: "re-row",
          minWeightIncrement: 2.5,
          linearPeriodization: null,
          sets: [{ setNumber: 1, weight: 50 }],
        },
      ],
    };
    const rewound = rewindLoggedDay(day, new Map([["re-bench", 1]]));
    const [bench, row] = rewound.exercises;
    assert.equal(bench.linearPeriodization?.step, 1);
    assert.deepEqual(
      bench.sets.map((set) => set.weight),
      [40, 62.5, 62.5, 62.5],
    );
    assert.equal(row, day.exercises[1]);
    // The routine's own day is never changed.
    assert.equal(day.exercises[0].linearPeriodization?.step, 3);
  });
});

describe("what a logged workout leaves out", () => {
  it("is never corrected: it is removed and logged again", () => {
    const window = sessionCorrectionWindow(
      {
        status: "COMPLETED",
        endedAt: new Date("2026-10-10T10:00:00Z"),
        isLatest: true,
        laterSessionStarted: false,
        correctionCount: 0,
        loggedLater: true,
      },
      new Date("2026-10-10T12:00:00Z"),
    );
    assert.equal(window.closedReason, "LOGGED_LATER");
  });

  it("keeps events with no session when its events are left out", () => {
    assert.deepEqual(notFromSessions([]), {});
    assert.deepEqual(notFromSessions(["s1"]), {
      OR: [{ sessionId: null }, { sessionId: { notIn: ["s1"] } }],
    });
  });
});
