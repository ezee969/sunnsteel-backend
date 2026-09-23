import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  SESSION_CORRECTION_WINDOW_HOURS,
  SESSION_CORRECTIONS_MAX,
  sessionCorrectionWindow,
} from '@sunsteel/contracts';
import {
  applySetCorrections,
  beatsRecord,
  contributionDelta,
  correctedPrescription,
  type CorrectableLog,
  planSetCorrections,
  prescriptionIntact,
} from '../src/workouts/session-correction-rules';

const endedAt = new Date('2026-09-23T10:00:00.000Z');
const log = (id: string, values: Partial<CorrectableLog> = {}): CorrectableLog => ({
  id,
  exerciseId: 'bench',
  routineExerciseId: 're-1',
  sourceRoutineExerciseId: null,
  setNumber: 1,
  weight: 100,
  reps: 5,
  rpe: 8,
  isCompleted: true,
  completedAt: new Date('2026-09-23T09:30:00.000Z'),
  ...values,
});
const names = new Map([['bench', 'Bench Press']]);
const request = (setLogId: string, values: Partial<CorrectableLog> = {}) => ({
  setLogId,
  weight: 100,
  reps: 5,
  rpe: 8,
  isCompleted: true,
  ...values,
});

test('the window is open only for the latest completed workout, before another starts', () => {
  const base = {
    status: 'COMPLETED',
    endedAt,
    isLatest: true,
    laterSessionStarted: false,
    correctionCount: 0,
  };
  const now = new Date(endedAt.getTime() + 3600_000);
  const open = sessionCorrectionWindow(base, now);
  assert.equal(open.closedReason, null);
  assert.equal(
    open.correctableUntil,
    new Date(
      endedAt.getTime() + SESSION_CORRECTION_WINDOW_HOURS * 3600_000,
    ).toISOString(),
  );
  const reason = (input: Partial<typeof base>, at = now) =>
    sessionCorrectionWindow({ ...base, ...input }, at).closedReason;
  assert.equal(reason({ status: 'ABORTED' }), 'NOT_COMPLETED');
  assert.equal(reason({ status: 'IN_PROGRESS', endedAt: null as never }), 'NOT_COMPLETED');
  assert.equal(reason({ isLatest: false }), 'NOT_LATEST');
  assert.equal(reason({ laterSessionStarted: true }), 'LATER_SESSION');
  assert.equal(
    reason({}, new Date(endedAt.getTime() + SESSION_CORRECTION_WINDOW_HOURS * 3600_000)),
    'WINDOW_PASSED',
  );
  assert.equal(reason({ correctionCount: SESSION_CORRECTIONS_MAX }), 'LIMIT_REACHED');
  assert.equal(sessionCorrectionWindow({ ...base, isLatest: false }, now).correctableUntil, null);
});

test('a correction records only the sets it changes, with before and after', () => {
  const logs = [log('a'), log('b', { setNumber: 2 })];
  const changes = planSetCorrections(
    logs,
    [request('a', { weight: 10 }), request('b', { setNumber: 2 } as never)],
    names,
  );
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], {
    setLogId: 'a',
    exerciseId: 'bench',
    exerciseName: 'Bench Press',
    setNumber: 1,
    before: { weight: 100, reps: 5, rpe: 8, isCompleted: true },
    after: { weight: 10, reps: 5, rpe: 8, isCompleted: true },
  });
});

test('an omitted value is empty rather than kept', () => {
  const [change] = planSetCorrections(
    [log('a')],
    [{ setLogId: 'a', weight: 100, reps: 5, isCompleted: true } as never],
    names,
  );
  assert.equal(change.after.rpe, null);
});

test('a correction is refused when it names another workout set, repeats one, or changes nothing', () => {
  assert.throws(
    () => planSetCorrections([log('a')], [request('z', { weight: 1 })], names),
    /does not belong/,
  );
  assert.throws(
    () =>
      planSetCorrections(
        [log('a')],
        [request('a', { weight: 1 }), request('a', { weight: 2 })],
        names,
      ),
    /once per request/,
  );
  assert.throws(
    () => planSetCorrections([log('a')], [request('a')], names),
    /Nothing to correct/,
  );
});

test('a corrected value must be plausible, and a completed set needs a rep', () => {
  const refused = (values: Partial<CorrectableLog>, pattern: RegExp) =>
    assert.throws(
      () => planSetCorrections([log('a')], [request('a', values)], names),
      pattern,
    );
  refused({ weight: 1501 }, /Weight/);
  refused({ weight: -1 }, /Weight/);
  refused({ reps: 2.5 }, /whole number/);
  refused({ reps: 1001 }, /Reps/);
  refused({ rpe: 11 }, /RPE/);
  refused({ reps: 0 }, /at least one rep/);
  refused({ reps: null }, /at least one rep/);
  // An unticked set may keep no reps.
  assert.equal(
    planSetCorrections([log('a')], [request('a', { reps: null, isCompleted: false })], names)
      .length,
    1,
  );
});

test('applying a correction keeps or clears the completion time, and keeps one completed set', () => {
  const logs = [log('a'), log('b', { isCompleted: false, completedAt: null })];
  const changes = planSetCorrections(
    logs,
    [request('a', { isCompleted: false }), request('b', { isCompleted: true })],
    names,
  );
  const corrected = applySetCorrections(logs, changes, endedAt);
  assert.equal(corrected[0].completedAt, null);
  assert.equal(corrected[1].completedAt, endedAt);
  assert.throws(
    () =>
      applySetCorrections(
        [log('a')],
        planSetCorrections([log('a')], [request('a', { isCompleted: false })], names),
        endedAt,
      ),
    /at least one completed set/,
  );
});

test('a record is heavier, or more reps at the same weight; a tie is not one', () => {
  assert.equal(beatsRecord({ weight: 100, reps: 5 }, null), true);
  assert.equal(beatsRecord({ weight: 102.5, reps: 1 }, { weight: 100, reps: 5 }), true);
  assert.equal(beatsRecord({ weight: 100, reps: 6 }, { weight: 100, reps: 5 }), true);
  assert.equal(beatsRecord({ weight: 100, reps: 5 }, { weight: 100, reps: 5 }), false);
  assert.equal(beatsRecord({ weight: 90, reps: 12 }, { weight: 100, reps: 5 }), false);
});

test('a load change is re-derived only while the routine still reads what the finish wrote', () => {
  const snapshot = [
    { setNumber: 1, weight: 100 },
    { setNumber: 2, weight: 100 },
  ];
  const finish = [
    { routineExerciseId: 're-1', setNumber: 1, newWeight: 1002.5 },
    { routineExerciseId: 're-1', setNumber: 2, newWeight: 102.5 },
  ];
  const untouched = [
    { setNumber: 1, weight: 1002.5 },
    { setNumber: 2, weight: 102.5 },
  ];
  assert.equal(prescriptionIntact(snapshot, untouched, finish), true);
  assert.equal(
    prescriptionIntact(snapshot, [{ setNumber: 1, weight: 1002.5 }, { setNumber: 2, weight: 110 }], finish),
    false,
    'an edited weight wins',
  );
  assert.equal(prescriptionIntact(snapshot, [untouched[0]], finish), false, 'a removed set wins');
  // A set the finish did not write keeps its prescribed weight.
  assert.equal(
    prescriptionIntact(snapshot, [{ setNumber: 1, weight: 1002.5 }, { setNumber: 2, weight: 100 }], [finish[0]]),
    true,
  );
  assert.deepEqual(
    correctedPrescription(snapshot, [{ routineExerciseId: 're-1', setNumber: 1, newWeight: 102.5 }]),
    [
      { setNumber: 1, weight: 102.5 },
      { setNumber: 2, weight: 100 },
    ],
  );
});

test('the rollup delta is the corrected contribution minus the old one, muscle by muscle', () => {
  const delta = contributionDelta(
    {
      volumeKg: 5512.5,
      completedSets: 2,
      muscles: [
        ['CHEST', { volumeKg: 5512.5, completedSets: 2 }],
        ['TRICEPS', { volumeKg: 2756.25, completedSets: 1 }],
      ],
    },
    {
      volumeKg: 922.5,
      completedSets: 2,
      muscles: [
        ['CHEST', { volumeKg: 922.5, completedSets: 2 }],
        ['SHOULDERS', { volumeKg: 10, completedSets: 0.5 }],
      ],
    },
  );
  assert.equal(delta.volumeKg, -4590);
  assert.equal(delta.completedSets, 0);
  assert.deepEqual(delta.muscles, [
    ['CHEST', { volumeKg: -4590, completedSets: 0 }],
    ['SHOULDERS', { volumeKg: 10, completedSets: 0.5 }],
    ['TRICEPS', { volumeKg: -2756.25, completedSets: -1 }],
  ]);
});
