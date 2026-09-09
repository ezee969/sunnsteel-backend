import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseService } from '../src/database/database.service';
import {
  buildSessionRecapRecords,
  summarizeRecapSets,
} from '../src/workouts/session-recap';
import { WorkoutSessionRecapService } from '../src/workouts/services/workout-session-recap.service';

const completedAt = new Date('2026-09-09T10:00:00.000Z');

const set = (
  id: string,
  exerciseId: string,
  exerciseName: string,
  setNumber: number,
  weight: number,
  reps: number,
) => ({
  id,
  exerciseId,
  exerciseName,
  setNumber,
  weight,
  reps,
  isCompleted: true,
  completedAt,
});

test('recap rebuilds the final four-category record frontier', () => {
  const current = [set('current', 'bench', 'Bench Press', 2, 95, 11)];
  const history = [
    { exerciseId: 'bench', weight: 100, reps: 8, isCompleted: true },
    { exerciseId: 'bench', weight: 80, reps: 10, isCompleted: true },
  ];

  assert.deepEqual(
    buildSessionRecapRecords(current, history, completedAt).map((record) => [
      record.kind,
      record.value,
      record.previousBest,
      record.setNumber,
      record.achievedAt,
    ]),
    [
      ['REPS', 11, 10, 2, completedAt.toISOString()],
      ['VOLUME', 1045, 800, 2, completedAt.toISOString()],
      ['ESTIMATED_1RM', 129.8, 126.7, 2, completedAt.toISOString()],
    ],
  );
});

test('recap keeps bodyweight records truthful and one best per kind', () => {
  const records = buildSessionRecapRecords(
    [
      set('first', 'pull-up', 'Pull Up', 1, 0, 10),
      set('second', 'pull-up', 'Pull Up', 2, 0, 12),
    ],
    [],
    completedAt,
  );

  assert.deepEqual(
    records.map((record) => [record.kind, record.value, record.setNumber]),
    [['REPS', 12, 2]],
  );
});

test('recap metrics ignore incomplete work', () => {
  assert.deepEqual(
    summarizeRecapSets([
      { weight: 100, reps: 8, isCompleted: true },
      { weight: 120, reps: 5, isCompleted: false },
      { weight: null, reps: 12, isCompleted: true },
    ]),
    { completedSets: 2, totalVolumeKg: 800 },
  );
});

test('session recap composes persisted metrics, events and the previous day', async () => {
  const progressionChange = {
    routineExerciseId: 'routine-exercise-1',
    exerciseId: 'bench',
    exerciseName: 'Bench Press',
    progressionScheme: 'DOUBLE_PROGRESSION',
    rule: 'ALL_SETS_REACHED_TARGET',
    minWeightIncrementKg: 2.5,
    sets: [],
  };
  const current = {
    id: 'current-session',
    status: 'COMPLETED',
    startedAt: new Date('2026-09-09T09:58:00.000Z'),
    endedAt: new Date('2026-09-09T10:00:00.000Z'),
    durationSec: 120,
    totalVolumeKg: 840,
    completedSets: 1,
    notes: 'Strong finish',
    sourceRoutineDayId: 'day-1',
    routineDayId: null,
    snapshot: {
      payload: {
        schemaVersion: 1,
        sessionId: 'current-session',
        sourceRoutineId: 'routine-1',
        sourceRoutineDayId: 'day-1',
        capturedAt: '2026-09-09T09:58:00.000Z',
        provenance: 'CAPTURED',
        notes: null,
        routine: { id: 'routine-1', name: 'Strength Day' },
        routineDay: {
          id: 'day-1',
          dayOfWeek: 2,
          exercises: [{ id: 'routine-exercise-1' }],
        },
      },
    },
    routine: null,
    routineDay: null,
    setLogs: [
      {
        id: 'current-set',
        exerciseId: 'bench',
        setNumber: 1,
        reps: 8,
        weight: 105,
        isCompleted: true,
        completedAt,
        exercise: { name: 'Bench Press' },
      },
    ],
  };
  const previous = {
    id: 'previous-session',
    endedAt: new Date('2026-09-02T10:00:00.000Z'),
    durationSec: 100,
    totalVolumeKg: 800,
    completedSets: 1,
    setLogs: [{ reps: 8, weight: 100, isCompleted: true }],
  };
  const sessionResponses = [current, previous];
  const db = {
    workoutSession: {
      findFirst: () => Promise.resolve(sessionResponses.shift() ?? null),
    },
    setLog: {
      findMany: () =>
        Promise.resolve([
          {
            exerciseId: 'bench',
            reps: 8,
            weight: 100,
            isCompleted: true,
          },
        ]),
    },
    trainingEvent: {
      findMany: () => Promise.resolve([{ payload: progressionChange }]),
    },
  };
  const service = new WorkoutSessionRecapService(
    db as unknown as DatabaseService,
  );

  const recap = await service.getSessionRecap('owner', 'current-session');

  assert.equal(recap.routineName, 'Strength Day');
  assert.equal(recap.dayName, 'Tuesday');
  assert.equal(recap.notes, 'Strong finish');
  assert.deepEqual(
    recap.records.map((record) => record.kind),
    ['WEIGHT', 'VOLUME', 'ESTIMATED_1RM'],
  );
  assert.deepEqual(recap.progressionChanges, [progressionChange]);
  assert.deepEqual(recap.previousSession, {
    sessionId: 'previous-session',
    endedAt: '2026-09-02T10:00:00.000Z',
    durationSec: 100,
    totalVolumeKg: 800,
    completedSets: 1,
    durationDeltaSec: 20,
    volumeDeltaKg: 40,
    completedSetsDelta: 0,
  });
});
