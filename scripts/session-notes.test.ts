import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  SESSION_EXERCISE_NOTE_MAX_LENGTH,
  SESSION_NOTE_MAX_LENGTH,
  type WorkoutSessionRecap,
  type WorkoutSessionSnapshotV1,
} from '@sunsteel/contracts';
import {
  mergeExerciseNotes,
  normalizeSessionNote,
  readExerciseNotes,
  recapExerciseNotes,
} from '../src/workouts/session-notes';
import { projectSharedRecap } from '../src/workouts/workout-session-share.service';

const slot = (id: string, name: string) =>
  ({
    id,
    order: 0,
    progressionScheme: 'NONE',
    minWeightIncrement: 2.5,
    exercise: { id: `${id}-ex`, name, primaryMuscles: [], secondaryMuscles: [] },
    sets: [],
  }) as unknown as WorkoutSessionSnapshotV1['routineDay']['exercises'][number];

test('the notes column is read defensively', () => {
  assert.deepEqual(readExerciseNotes(null), []);
  assert.deepEqual(
    readExerciseNotes([
      { routineExerciseId: 'a', note: 'Grip slipped' },
      { routineExerciseId: 'b' },
      'junk',
    ]),
    [{ routineExerciseId: 'a', note: 'Grip slipped' }],
  );
});

test('a workout note is trimmed, cleared when empty, and never cut', () => {
  assert.equal(normalizeSessionNote('  Slept badly  '), 'Slept badly');
  assert.equal(normalizeSessionNote('   '), null);
  assert.equal(normalizeSessionNote(null), null);
  assert.throws(
    () => normalizeSessionNote('x'.repeat(SESSION_NOTE_MAX_LENGTH + 1)),
    /at most 2000/,
  );
});

test('exercise notes merge by slot, clear with an empty note and keep the day order', () => {
  const current = [
    { routineExerciseId: 'b', note: 'Old bench note' },
    { routineExerciseId: 'c', note: 'Rows felt easy' },
  ];
  assert.deepEqual(
    mergeExerciseNotes(
      current,
      [
        { routineExerciseId: 'a', note: ' Knee twinge on rep 3 ' },
        { routineExerciseId: 'b', note: null },
      ],
      ['a', 'b', 'c'],
    ),
    [
      { routineExerciseId: 'a', note: 'Knee twinge on rep 3' },
      { routineExerciseId: 'c', note: 'Rows felt easy' },
    ],
  );
});

test('an exercise note must belong to this workout and fit', () => {
  assert.throws(
    () => mergeExerciseNotes([], [{ routineExerciseId: 'z', note: 'x' }], ['a']),
    /not part of this workout/,
  );
  assert.throws(
    () =>
      mergeExerciseNotes(
        [],
        [
          { routineExerciseId: 'a', note: 'x' },
          { routineExerciseId: 'a', note: 'y' },
        ],
        ['a'],
      ),
    /once per request/,
  );
  assert.throws(
    () =>
      mergeExerciseNotes(
        [],
        [{ routineExerciseId: 'a', note: 'x'.repeat(SESSION_EXERCISE_NOTE_MAX_LENGTH + 1) }],
        ['a'],
      ),
    /at most 500/,
  );
});

test('the recap names a noted exercise as it was performed, in day order', () => {
  const notes = [
    { routineExerciseId: 'b', note: 'Used the machine' },
    { routineExerciseId: 'a', note: 'Paused reps' },
  ];
  const named = recapExerciseNotes(notes, [slot('a', 'Squat'), slot('b', 'Bench Press')], [
    {
      routineExerciseId: 'b',
      exercise: { id: 'chest-press', name: 'Chest Press', primaryMuscles: [], secondaryMuscles: [] },
      substitutedAt: '2026-09-23T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(named, [
    { routineExerciseId: 'a', exerciseName: 'Squat', note: 'Paused reps' },
    { routineExerciseId: 'b', exerciseName: 'Chest Press', note: 'Used the machine' },
  ]);
});

test('a shared link carries exercise notes only when notes were chosen', () => {
  const recap = {
    sessionId: 's',
    routineName: 'Upper',
    startedAt: '2026-09-23T09:00:00.000Z',
    endedAt: '2026-09-23T10:00:00.000Z',
    durationSec: 3600,
    totalVolumeKg: 1000,
    completedSets: 10,
    notes: 'Good day',
    exerciseNotes: [{ routineExerciseId: 'a', exerciseName: 'Squat', note: 'Paused reps' }],
    records: [],
    progressionChanges: [],
    previousSession: null,
  } satisfies WorkoutSessionRecap;
  const owner = { username: 'lee', name: 'Lee' };
  assert.deepEqual(
    projectSharedRecap(recap, ['notes'], owner, 'KG').exerciseNotes,
    recap.exerciseNotes,
  );
  assert.equal('exerciseNotes' in projectSharedRecap(recap, ['duration'], owner, 'KG'), false);
});
