import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseService } from '../src/database/database.service';
import {
  earnedPersonalRecords,
  recordFrontier,
} from '../src/workouts/live-personal-records';
import { WorkoutSessionLogService } from '../src/workouts/services/workout-session-log.service';

const loadedSet = (weight: number, reps: number, isCompleted = true) => ({
  weight,
  reps,
  isCompleted,
});

test('a first loaded set earns all four record kinds', () => {
  const records = earnedPersonalRecords({
    candidate: loadedSet(100, 8),
    existing: null,
    previous: recordFrontier([]),
    exerciseId: 'bench',
    exerciseName: 'Bench Press',
  });

  assert.deepEqual(
    records.map((record) => [record.kind, record.value, record.previousBest]),
    [
      ['WEIGHT', 100, undefined],
      ['REPS', 8, undefined],
      ['VOLUME', 800, undefined],
      ['ESTIMATED_1RM', 126.7, undefined],
    ],
  );
});

test('bodyweight work can earn a rep record without false load records', () => {
  const records = earnedPersonalRecords({
    candidate: loadedSet(0, 12),
    existing: null,
    previous: recordFrontier([]),
    exerciseId: 'pull-up',
    exerciseName: 'Pull Up',
  });

  assert.deepEqual(
    records.map((record) => record.kind),
    ['REPS'],
  );
});

test('only frontiers crossed by the new values are emitted', () => {
  const records = earnedPersonalRecords({
    candidate: loadedSet(95, 11),
    existing: loadedSet(95, 10),
    previous: recordFrontier([loadedSet(100, 8), loadedSet(80, 10)]),
    exerciseId: 'bench',
    exerciseName: 'Bench Press',
  });

  assert.deepEqual(
    records.map((record) => [record.kind, record.value, record.previousBest]),
    [
      ['REPS', 11, 10],
      ['VOLUME', 1045, 950],
      ['ESTIMATED_1RM', 129.8, 126.7],
    ],
  );
});

test('identical autosaves and incomplete sets do not repeat records', () => {
  const previous = recordFrontier([loadedSet(80, 10)]);
  const repeated = earnedPersonalRecords({
    candidate: loadedSet(100, 8),
    existing: loadedSet(100, 8),
    previous,
    exerciseId: 'bench',
    exerciseName: 'Bench Press',
  });
  const incomplete = earnedPersonalRecords({
    candidate: loadedSet(120, 12, false),
    existing: null,
    previous,
    exerciseId: 'bench',
    exerciseName: 'Bench Press',
  });

  assert.deepEqual(repeated, []);
  assert.deepEqual(incomplete, []);
});

test('set-log mutation scopes the frontier and returns serialized earned records', async () => {
  const now = new Date('2026-09-08T08:00:00.000Z');
  let priorWhere: any;
  const tx = {
    $queryRaw: async () => [],
    workoutSession: {
      findFirst: async () => ({
        id: 'session-1',
        status: 'IN_PROGRESS',
        routineDayId: 'day-1',
      }),
      update: async () => ({ id: 'session-1' }),
    },
    routineExercise: {
      findFirst: async () => ({
        id: 'routine-exercise-1',
        exerciseId: 'bench',
        exercise: { name: 'Bench Press' },
      }),
    },
    setLog: {
      findUnique: async () => ({
        id: 'set-1',
        reps: 10,
        weight: 95,
        isCompleted: true,
      }),
      findMany: async (args: any) => {
        priorWhere = args.where;
        return [loadedSet(100, 8)];
      },
      upsert: async () => ({
        id: 'set-1',
        sessionId: 'session-1',
        routineExerciseId: 'routine-exercise-1',
        sourceRoutineExerciseId: 'routine-exercise-1',
        exerciseId: 'bench',
        setNumber: 1,
        reps: 11,
        weight: 95,
        rpe: 8,
        isCompleted: true,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    },
  };
  const db = {
    $transaction: async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
  };
  const service = new WorkoutSessionLogService(
    db as unknown as DatabaseService,
  );

  const response = await service.upsertSetLog('owner', 'session-1', {
    routineExerciseId: 'routine-exercise-1',
    exerciseId: 'bench',
    setNumber: 1,
    reps: 11,
    weight: 95,
    rpe: 8,
    isCompleted: true,
  });

  assert.equal(priorWhere.exerciseId, 'bench');
  assert.equal(priorWhere.isCompleted, true);
  assert.deepEqual(priorWhere.id, { not: 'set-1' });
  assert.equal(priorWhere.session.userId, 'owner');
  assert.deepEqual(
    response.earnedRecords.map((record) => record.kind),
    ['REPS', 'VOLUME', 'ESTIMATED_1RM'],
  );
  assert.equal(response.setLog.completedAt, now.toISOString());
  assert.equal(response.setLog.routineExerciseId, 'routine-exercise-1');
});
