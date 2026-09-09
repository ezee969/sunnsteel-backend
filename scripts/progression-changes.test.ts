import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProgressionOutcome } from '../src/workouts/progression-changes';

const exercise = (
  progressionScheme:
    | 'NONE'
    | 'DOUBLE_PROGRESSION'
    | 'DYNAMIC_DOUBLE_PROGRESSION',
) => ({
  id: 'routine-exercise-1',
  exerciseId: 'bench',
  exercise: { name: 'Bench Press' },
  progressionScheme,
  minWeightIncrement: 2.5,
  sets: [
    {
      setNumber: 1,
      repType: 'RANGE' as const,
      reps: null,
      minReps: 8,
      maxReps: 10,
      weight: 100,
    },
    {
      setNumber: 2,
      repType: 'FIXED' as const,
      reps: 8,
      minReps: null,
      maxReps: null,
      weight: 95,
    },
  ],
});

const log = (
  setNumber: number,
  reps: number,
  weight: number,
  isCompleted = true,
) => ({
  routineExerciseId: 'routine-exercise-1',
  setNumber,
  reps,
  weight,
  isCompleted,
});

test('double progression advances every set only after all completed targets', () => {
  const outcome = buildProgressionOutcome(
    [exercise('DOUBLE_PROGRESSION')],
    [log(1, 10, 102.5), log(2, 9, 97.5)],
  );

  assert.deepEqual(
    outcome.updates.map((update) => update.newWeight),
    [105, 100],
  );
  assert.deepEqual(outcome.changes, [
    {
      routineExerciseId: 'routine-exercise-1',
      exerciseId: 'bench',
      exerciseName: 'Bench Press',
      progressionScheme: 'DOUBLE_PROGRESSION',
      rule: 'ALL_SETS_REACHED_TARGET',
      minWeightIncrementKg: 2.5,
      sets: [
        {
          setNumber: 1,
          targetReps: 10,
          performedReps: 10,
          previousWeightKg: 102.5,
          newWeightKg: 105,
        },
        {
          setNumber: 2,
          targetReps: 8,
          performedReps: 9,
          previousWeightKg: 97.5,
          newWeightKg: 100,
        },
      ],
    },
  ]);
});

test('typed reps on an incomplete set cannot trigger progression', () => {
  const outcome = buildProgressionOutcome(
    [exercise('DOUBLE_PROGRESSION')],
    [log(1, 10, 102.5), log(2, 8, 97.5, false)],
  );

  assert.deepEqual(outcome.changes, []);
  assert.deepEqual(
    outcome.updates.map((update) => update.newWeight),
    [102.5, 97.5],
  );
});

test('dynamic progression advances and explains only completed sets that hit', () => {
  const outcome = buildProgressionOutcome(
    [exercise('DYNAMIC_DOUBLE_PROGRESSION')],
    [log(1, 10, 100), log(2, 7, 95)],
  );

  assert.deepEqual(
    outcome.updates.map((update) => update.newWeight),
    [102.5, 95],
  );
  assert.equal(outcome.changes[0].rule, 'SET_REACHED_TARGET');
  assert.deepEqual(outcome.changes[0].sets, [
    {
      setNumber: 1,
      targetReps: 10,
      performedReps: 10,
      previousWeightKg: 100,
      newWeightKg: 102.5,
    },
  ]);
});

test('no-progression prescriptions carry logged load without an event', () => {
  const outcome = buildProgressionOutcome(
    [exercise('NONE')],
    [log(1, 8, 110), log(2, 8, 105)],
  );

  assert.deepEqual(outcome.changes, []);
  assert.deepEqual(
    outcome.updates.map((update) => update.newWeight),
    [110, 105],
  );
});
