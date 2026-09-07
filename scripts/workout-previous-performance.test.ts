import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { WorkoutSessionReadService } from '../src/workouts/workout-session-read.service';

test('returns completed sets from the latest earlier execution of the same routine day', async () => {
  const calls: any[] = [];
  const responses = [
    {
      sourceRoutineDayId: 'day-1',
      routineDayId: 'live-day-1',
      startedAt: new Date('2026-09-07T10:00:00Z'),
    },
    {
      id: 'previous-session',
      endedAt: new Date('2026-09-05T11:00:00Z'),
      setLogs: [
        {
          sourceRoutineExerciseId: 'routine-exercise-1',
          routineExerciseId: null,
          exerciseId: 'exercise-1',
          setNumber: 1,
          reps: 8,
          weight: 80,
          rpe: 8.5,
        },
      ],
    },
  ];
  const db = {
    workoutSession: {
      findFirst: (args: any) => {
        calls.push(args);
        return Promise.resolve(responses.shift() ?? null);
      },
    },
  };
  const service = new WorkoutSessionReadService(
    db as unknown as DatabaseService,
  );

  assert.deepEqual(
    await service.getPreviousPerformance('owner', 'current-session'),
    {
      sessionId: 'previous-session',
      endedAt: '2026-09-05T11:00:00.000Z',
      sets: [
        {
          routineExerciseId: 'routine-exercise-1',
          exerciseId: 'exercise-1',
          setNumber: 1,
          reps: 8,
          weight: 80,
          rpe: 8.5,
        },
      ],
    },
  );
  assert.deepEqual(calls[0].where, {
    id: 'current-session',
    userId: 'owner',
  });
  assert.equal(calls[1].where.userId, 'owner');
  assert.equal(calls[1].where.status, 'COMPLETED');
  assert.deepEqual(calls[1].where.OR, [
    { sourceRoutineDayId: 'day-1' },
    { sourceRoutineDayId: null, routineDayId: 'day-1' },
  ]);
  assert.deepEqual(calls[1].where.endedAt, {
    lt: new Date('2026-09-07T10:00:00Z'),
  });
});

test('returns null when the routine day has no earlier completed session', async () => {
  const responses = [
    {
      sourceRoutineDayId: 'day-1',
      routineDayId: 'day-1',
      startedAt: new Date('2026-09-07T10:00:00Z'),
    },
    null,
  ];
  const db = {
    workoutSession: {
      findFirst: () => Promise.resolve(responses.shift() ?? null),
    },
  };
  const service = new WorkoutSessionReadService(
    db as unknown as DatabaseService,
  );

  assert.equal(
    await service.getPreviousPerformance('owner', 'current-session'),
    null,
  );
});

test('does not reveal whether another user owns the requested session', async () => {
  const db = {
    workoutSession: {
      findFirst: () => Promise.resolve(null),
    },
  };
  const service = new WorkoutSessionReadService(
    db as unknown as DatabaseService,
  );

  await assert.rejects(
    service.getPreviousPerformance('owner', 'other-session'),
    NotFoundException,
  );
});
