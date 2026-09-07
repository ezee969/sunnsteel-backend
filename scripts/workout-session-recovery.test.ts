import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkoutSessionStatus } from '@prisma/client';
import { DatabaseService } from '../src/database/database.service';
import { WorkoutSessionStartService } from '../src/workouts/services/workout-session-start.service';
import { WorkoutSessionReadService } from '../src/workouts/workout-session-read.service';

const activeSession = {
  id: 'stale-session',
  userId: 'owner',
  routineId: 'routine-1',
  sourceRoutineId: 'routine-1',
  routineDayId: 'day-1',
  sourceRoutineDayId: 'day-1',
  status: WorkoutSessionStatus.IN_PROGRESS,
  startedAt: new Date('2026-09-01T10:00:00Z'),
  endedAt: null,
};

test('resuming an active session refreshes its last activity', async () => {
  let updateArgs: any;
  const db = {
    workoutSession: {
      update: async (args: any) => {
        updateArgs = args;
        return { id: activeSession.id };
      },
    },
  };
  const read = {
    getActiveSession: async () => activeSession,
  };
  const service = new WorkoutSessionStartService(
    db as unknown as DatabaseService,
    read as unknown as WorkoutSessionReadService,
  );

  const response = await service.startSession('owner', {
    routineId: 'routine-1',
    routineDayId: 'day-1',
  });

  assert.equal(response.id, activeSession.id);
  assert.equal(response.reused, true);
  assert.deepEqual(updateArgs.where, { id: activeSession.id });
  assert.ok(updateArgs.data.lastActivityAt instanceof Date);
  assert.deepEqual(updateArgs.select, { id: true });
});

test('a heartbeat failure never hides the recoverable session', async () => {
  const db = {
    workoutSession: {
      update: async () => {
        throw new Error('database unavailable');
      },
    },
  };
  const read = {
    getActiveSession: async () => activeSession,
  };
  const service = new WorkoutSessionStartService(
    db as unknown as DatabaseService,
    read as unknown as WorkoutSessionReadService,
  );

  const response = await service.startSession('owner', {
    routineId: 'routine-1',
    routineDayId: 'day-1',
  });

  assert.equal(response.id, activeSession.id);
  assert.equal(response.reused, true);
});
