import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import {
  MATCH_MINI_SETS_MAX,
  MATCH_SETS_MAX,
  countsAsWork,
  countsForProgression,
  formatRepsDone,
  matchSetRefusal,
  matchTarget,
  matchTargetSetNumber,
  repsDone,
  requiredToFinish,
  setLogValuesDiffer,
  type WorkoutSessionSnapshotV1,
} from "@sunsteel/contracts";

import { sessionContribution } from "../src/workouts/analytics/analytics-contribution";
import { assertMatchSets } from "../src/routines/match-sets";
import { routineSetCreateData } from "../src/routines/routine-set-data";
import { summarizeRecapSets } from "../src/workouts/session-recap";
import { matchRepsWrite } from "../src/workouts/session-extra-sets";
import {
  applySetCorrections,
  planSetCorrections,
  type CorrectableLog,
} from "../src/workouts/session-correction-rules";

describe("myo-rep match: the kind", () => {
  it("counts as work, is required, and never progresses", () => {
    assert.equal(countsAsWork("MATCH"), true);
    assert.equal(requiredToFinish("MATCH"), true);
    assert.equal(countsForProgression("MATCH"), false);
  });
});

describe("myo-rep match: reps done", () => {
  it("adds the mini-sets to the first effort", () => {
    assert.equal(repsDone({ reps: 13, matchReps: [3, 2] }), 18);
    assert.equal(repsDone({ reps: 10 }), 10);
    assert.equal(repsDone({ reps: null, matchReps: [] }), 0);
  });

  it("reads 13 + 3 + 2, and the reps alone without mini-sets", () => {
    assert.equal(formatRepsDone({ reps: 13, matchReps: [3, 2] }), "13 + 3 + 2");
    assert.equal(formatRepsDone({ reps: 18, matchReps: [] }), "18");
  });
});

describe("myo-rep match: the target", () => {
  const sets = [
    { setNumber: 1, kind: "WARMUP" as const, reps: 8 },
    { setNumber: 2, kind: "WORKING" as const, reps: 18 },
    { setNumber: 3, kind: "MATCH" as const, reps: 13 },
    { setNumber: 4, kind: "MATCH" as const, reps: 11 },
  ];

  it("is the last working set before it, past match sets in between", () => {
    assert.equal(matchTargetSetNumber(sets, 3), 2);
    assert.equal(matchTargetSetNumber(sets, 4), 2);
    assert.equal(matchTarget(sets, 4), 18);
  });

  it("is none after a warm-up, and waits for the target's reps", () => {
    assert.equal(matchTargetSetNumber(sets, 2), null);
    assert.equal(
      matchTarget([{ setNumber: 1, kind: "WORKING", reps: 0 }, { setNumber: 2, kind: "MATCH" }], 2),
      null,
    );
  });
});

describe("myo-rep match: the prescription", () => {
  const set = (setNumber: number, kind: "WORKING" | "MATCH" | "WARMUP") => ({
    setNumber,
    kind,
  });

  it("follows a working set, at most three in a row", () => {
    assert.equal(matchSetRefusal([set(1, "WORKING"), set(2, "MATCH")], false), null);
    assert.equal(matchSetRefusal([set(1, "MATCH")], false), "MATCH_SET_PLACEMENT");
    assert.equal(
      matchSetRefusal([set(1, "WARMUP"), set(2, "MATCH")], false),
      "MATCH_SET_PLACEMENT",
    );
    const four = [set(1, "WORKING"), ...[2, 3, 4, 5].map((n) => set(n, "MATCH"))];
    assert.equal(MATCH_SETS_MAX, 3);
    assert.equal(matchSetRefusal(four, false), "MATCH_SETS_MAX");
  });

  it("is refused on an 8-week block", () => {
    assert.equal(
      matchSetRefusal([set(1, "WORKING"), set(2, "MATCH")], true),
      "MATCH_SET_LINEAR_BLOCK",
    );
    assert.throws(
      () => assertMatchSets([set(1, "WORKING"), set(2, "MATCH")], true),
      BadRequestException,
    );
  });

  it("stores a match set with no load and no reps of its own", () => {
    assert.deepEqual(
      routineSetCreateData({
        setNumber: 2,
        repType: "FIXED",
        reps: 12,
        weight: 40,
        kind: "MATCH",
      }),
      {
        setNumber: 2,
        repType: "FIXED",
        weight: null,
        kind: "MATCH",
        warmUpShare: null,
      },
    );
  });
});

describe("myo-rep match: mini-sets on a set log", () => {
  it("are kept only on a match set", () => {
    assert.deepEqual(matchRepsWrite("MATCH", [3, 2], []), { matchReps: [3, 2] });
    assert.deepEqual(matchRepsWrite("MATCH", undefined, [4]), { matchReps: [4] });
    assert.deepEqual(matchRepsWrite("WORKING", undefined, [4]), { matchReps: [] });
    const refused = matchRepsWrite("WORKING", [3], []);
    assert.ok("refusal" in refused);
    assert.equal(refused.refusal.code, "MATCH_MINI_SETS_NOT_MATCH");
  });

  it("are bounded by the sanity limit", () => {
    const refused = matchRepsWrite(
      "MATCH",
      Array.from({ length: MATCH_MINI_SETS_MAX + 1 }, () => 1),
      [],
    );
    assert.ok("refusal" in refused);
    assert.equal(refused.refusal.code, "MATCH_MINI_SETS_MAX");
  });
});

const snapshot = {
  schemaVersion: 1,
  sessionId: "s1",
  sourceRoutineId: "r1",
  sourceRoutineDayId: "d1",
  capturedAt: "2026-11-23T10:00:00.000Z",
  provenance: "CAPTURED",
  notes: null,
  routine: { id: "r1", name: "Arms" },
  routineDay: {
    id: "d1",
    exercises: [
      {
        id: "slot-curl",
        order: 0,
        progressionScheme: "NONE",
        minWeightIncrement: 2.5,
        exercise: {
          id: "curl",
          name: "Curl",
          primaryMuscles: ["BICEPS"],
          secondaryMuscles: [],
        },
        sets: [],
      },
    ],
  },
} as unknown as WorkoutSessionSnapshotV1;

const log = (
  id: string,
  reps: number,
  kind: "WORKING" | "MATCH",
  matchReps: number[] = [],
): CorrectableLog => ({
  id,
  exerciseId: "curl",
  routineExerciseId: "slot-curl",
  sourceRoutineExerciseId: "slot-curl",
  weight: 20,
  reps,
  rpe: null,
  isCompleted: true,
  completedAt: new Date(`2026-11-23T10:0${id.slice(-1)}:00.000Z`),
  kind,
  matchReps,
  setNumber: Number(id.slice(-1)),
});

describe("myo-rep match: what counts how", () => {
  const logs = [log("l1", 18, "WORKING"), log("l2", 13, "MATCH", [3, 2])];

  it("counts a match set once and every rep in volume", () => {
    const contribution = sessionContribution(
      logs,
      snapshot,
      new Date("2026-11-23T11:00:00.000Z"),
    );
    assert.equal(contribution.completedSets, 2);
    assert.equal(contribution.volumeKg, 20 * 18 + 20 * 18);
    assert.equal(summarizeRecapSets(logs).totalVolumeKg, 720);
  });

  it("takes records from the first effort only", () => {
    const contribution = sessionContribution(
      [log("l1", 12, "WORKING"), log("l2", 11, "MATCH", [5, 4])],
      snapshot,
      new Date("2026-11-23T11:00:00.000Z"),
    );
    const record = [...contribution.records.values()][0];
    assert.equal(record.reps, 12);
  });
});

describe("myo-rep match: corrections", () => {
  const names = new Map([["curl", "Curl"]]);

  it("correct a match set's mini-sets, and keep them when omitted", () => {
    const logs = [log("l1", 18, "WORKING"), log("l2", 13, "MATCH", [3, 2])];
    const changes = planSetCorrections(
      logs,
      [{ setLogId: "l2", weight: 20, reps: 13, rpe: null, isCompleted: true, matchReps: [3, 1] }],
      names,
    );
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].after.matchReps, [3, 1]);
    const corrected = applySetCorrections(logs, changes, new Date());
    assert.deepEqual(corrected[1].matchReps, [3, 1]);

    const kept = planSetCorrections(
      logs,
      [{ setLogId: "l2", weight: 22.5, reps: 13, rpe: null, isCompleted: true }],
      names,
    );
    assert.deepEqual(kept[0].after.matchReps, [3, 2]);
  });

  it("refuse mini-sets on any other set, and record none on one", () => {
    const logs = [log("l1", 18, "WORKING")];
    assert.throws(
      () =>
        planSetCorrections(
          logs,
          [{ setLogId: "l1", weight: 20, reps: 17, rpe: null, isCompleted: true, matchReps: [2] }],
          names,
        ),
      BadRequestException,
    );
    const changes = planSetCorrections(
      logs,
      [{ setLogId: "l1", weight: 20, reps: 17, rpe: null, isCompleted: true }],
      names,
    );
    assert.equal("matchReps" in changes[0].before, false);
  });

  it("see a change in the mini-sets alone", () => {
    const base = { weight: 20, reps: 13, rpe: null, isCompleted: true };
    assert.equal(
      setLogValuesDiffer({ ...base, matchReps: [3, 2] }, { ...base, matchReps: [3, 1] }),
      true,
    );
    assert.equal(setLogValuesDiffer(base, { ...base, matchReps: [] }), false);
  });
});
