import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { WorkoutSessionSnapshotV1 } from '@sunsteel/contracts';
import {
  localDate,
  nextStreak,
  sessionContribution,
  weekDate,
  AnalyticsLog,
  contributionChecksum,
} from '../src/workouts/analytics/analytics-contribution';

export const snapshot: WorkoutSessionSnapshotV1 = {
  schemaVersion: 1,
  sessionId: 'session',
  sourceRoutineId: 'routine',
  sourceRoutineDayId: 'day',
  capturedAt: '2026-01-01T00:00:00Z',
  provenance: 'CAPTURED',
  notes: null,
  routine: { id: 'routine', name: 'Original routine' },
  routineDay: {
    id: 'day',
    dayOfWeek: 1,
    exercises: [
      {
        id: 'rx',
        order: 0,
        progressionScheme: 'NONE',
        minWeightIncrement: 2.5,
        exercise: {
          id: 'exercise',
          name: 'Squat',
          primaryMuscles: ['QUADRICEPS'],
          secondaryMuscles: ['GLUTES'],
        },
        sets: [],
      },
    ],
  },
};
const endedAt = new Date('2026-09-06T12:00:00Z');
const log = (
  id: string,
  weight: number | null,
  reps: number | null,
  isCompleted = true,
): AnalyticsLog => ({
  id,
  weight,
  reps,
  isCompleted,
  exerciseId: 'exercise',
  routineExerciseId: 'rx',
  sourceRoutineExerciseId: 'rx',
  completedAt: null,
});

test('local dates and weeks use calendar arithmetic across DST and midnight', () => {
  assert.equal(
    localDate(new Date('2026-03-29T00:30:00Z'), 'Europe/Berlin'),
    '2026-03-29',
  );
  assert.equal(
    localDate(new Date('2026-03-29T22:30:00Z'), 'Europe/Berlin'),
    '2026-03-30',
  );
  assert.equal(
    localDate(new Date('2026-10-25T01:30:00Z'), 'Europe/Berlin'),
    '2026-10-25',
  );
  assert.equal(
    localDate(new Date('2026-09-06T00:30:00Z'), 'America/New_York'),
    '2026-09-05',
  );
  assert.equal(weekDate('2026-03-29'), '2026-03-23');
});
test('incremental streak counts distinct local days including empty sessions', () => {
  let state = {
    lastTrainingDate: null as string | null,
    currentRun: 0,
    bestRun: 0,
  };
  for (const date of [
    '2026-03-27',
    '2026-03-27',
    '2026-03-28',
    '2026-03-30',
    '2026-04-02',
    '2026-04-06',
  ])
    state = nextStreak(state, date);
  assert.deepEqual(state, {
    lastTrainingDate: '2026-04-06',
    currentRun: 1,
    bestRun: 4,
  });
  assert.throws(() => nextStreak(state, '2026-04-05'), /Non-monotonic/);
});
test('volume counts null, zero and fractional values only for completed sets; rounding is serialization only', () => {
  const result = sessionContribution(
    [
      log('1', null, 5),
      log('2', 10, null),
      log('3', 0, 5),
      log('4', 2.125, 3),
      log('5', 999, 3, false),
    ],
    snapshot,
    endedAt,
  );
  assert.equal(result.completedSets, 4);
  assert.equal(result.volumeKg, 6.375);
  assert.equal(Math.round(result.volumeKg), 6);
  assert.deepEqual(result.muscles, [
    ['GLUTES', { volumeKg: 3.1875, completedSets: 2 }],
    ['QUADRICEPS', { volumeKg: 6.375, completedSets: 4 }],
  ]);
});
test('PR ordering is weight then reps, exact tie keeps first achievement regardless of input order', () => {
  const rows = [
    log('later', 100, 8),
    log('heavier', 101, 1),
    log('first', 101, 2),
    log('last', 101, 2),
  ];
  rows[2].completedAt = new Date('2026-09-06T10:00:00Z');
  const a = sessionContribution(rows, snapshot, endedAt);
  const b = sessionContribution([...rows].reverse(), snapshot, endedAt);
  assert.deepEqual(a, b);
  assert.equal(a.records[0].setLogId, 'first');
  assert.equal(a.records[0].estimated1rm, 107.7);
  assert.equal(
    contributionChecksum('', 'session', endedAt, a),
    contributionChecksum('', 'session', endedAt, b),
  );
});
