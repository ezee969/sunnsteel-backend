import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { DatabaseService } from '../src/database/database.service';
import {
  MAX_EXTRA_SETS,
  extraSetRefusal,
  prescribedSetCount,
  removeSetRefusal,
} from '../src/workouts/session-extra-sets';
import { WorkoutSessionLogService } from '../src/workouts/services/workout-session-log.service';

const snapshot = (sets: number) => ({
  schemaVersion: 1,
  sessionId: 'session-1',
  sourceRoutineId: 'routine-1',
  sourceRoutineDayId: 'day-1',
  capturedAt: '2026-09-24T08:00:00.000Z',
  provenance: 'CAPTURED',
  notes: null,
  routine: { id: 'routine-1', name: 'Upper' },
  routineDay: {
    id: 'day-1',
    dayOfWeek: 1,
    exercises: [
      {
        id: 'slot-bench',
        sets: Array.from({ length: sets }, (_, i) => ({ setNumber: i + 1 })),
      },
    ],
  },
});

describe('prescribed set count', () => {
  it('reads the snapshot, not the routine as it is now', () => {
    assert.equal(
      prescribedSetCount(snapshot(3), 'slot-bench', [{ setNumber: 1 }]),
      3,
    );
  });

  it('falls back to the live routine without a snapshot or slot', () => {
    const live = [{ setNumber: 1 }, { setNumber: 2 }];
    assert.equal(prescribedSetCount(null, 'slot-bench', live), 2);
    assert.equal(prescribedSetCount(snapshot(3), 'slot-row', live), 2);
  });
});

describe('extra set rules', () => {
  it('accepts any prescribed set and the next set after the last', () => {
    assert.equal(extraSetRefusal(2, 3, 0), null);
    assert.equal(extraSetRefusal(4, 3, 1), null);
    assert.equal(extraSetRefusal(5, 3, 4), null);
  });

  it('refuses a gap after the last set', () => {
    assert.match(extraSetRefusal(5, 3, 3) ?? '', /after the last set/);
    assert.match(extraSetRefusal(6, 3, 4) ?? '', /after the last set/);
  });

  it('caps the extras of one exercise', () => {
    const last = 3 + MAX_EXTRA_SETS;
    assert.equal(extraSetRefusal(last, 3, last - 1), null);
    assert.match(extraSetRefusal(last + 1, 3, last) ?? '', /at most/);
  });

  it('removes only the last extra set', () => {
    assert.match(removeSetRefusal(3, 3, 5) ?? '', /prescribed/);
    assert.match(removeSetRefusal(4, 3, 5) ?? '', /last added/);
    assert.equal(removeSetRefusal(5, 3, 5), null);
  });
});

function fakeDb(options: { highest?: number; existing?: boolean } = {}) {
  const calls = { upserts: 0, deletes: 0 };
  const now = new Date('2026-09-24T08:00:00.000Z');
  const tx = {
    $queryRaw: async () => [],
    workoutSession: {
      findFirst: async () => ({
        id: 'session-1',
        status: 'IN_PROGRESS',
        routineDayId: 'day-1',
        exerciseSubstitutions: [],
        snapshot: { payload: snapshot(3) },
      }),
      update: async () => ({ id: 'session-1' }),
    },
    routineExercise: {
      findFirst: async () => ({
        id: 'slot-bench',
        exerciseId: 'bench',
        exercise: { name: 'Bench Press' },
        sets: [{ setNumber: 1 }, { setNumber: 2 }, { setNumber: 3 }],
      }),
    },
    routineExerciseSet: {
      findMany: async () => [
        { setNumber: 1 },
        { setNumber: 2 },
        { setNumber: 3 },
      ],
    },
    setLog: {
      findUnique: async () =>
        options.existing
          ? { id: 'set-5', reps: 8, weight: 60, isCompleted: false }
          : null,
      findFirst: async () =>
        options.highest ? { setNumber: options.highest } : null,
      findMany: async () => [],
      upsert: async (args: { create: { setNumber: number } }) => {
        calls.upserts += 1;
        return {
          id: 'set-new',
          sessionId: 'session-1',
          routineExerciseId: 'slot-bench',
          sourceRoutineExerciseId: 'slot-bench',
          exerciseId: 'bench',
          setNumber: args.create.setNumber,
          reps: 8,
          weight: 60,
          rpe: null,
          isCompleted: false,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        };
      },
      delete: async () => {
        calls.deletes += 1;
        return { id: 'set-deleted' };
      },
    },
  };
  const db = {
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  };
  return {
    calls,
    service: new WorkoutSessionLogService(db as unknown as DatabaseService),
  };
}

const upsert = (setNumber: number) => ({
  routineExerciseId: 'slot-bench',
  exerciseId: 'bench',
  setNumber,
  reps: 8,
  weight: 60,
});

describe('WorkoutSessionLogService extra sets', () => {
  it('adds the next set after the last one', async () => {
    const db = fakeDb({ highest: 3 });
    const res = await db.service.upsertSetLog('user-1', 'session-1', upsert(4));
    assert.equal(res.setLog.setNumber, 4);
    assert.equal(db.calls.upserts, 1);
  });

  it('refuses a new set that would leave a gap, and writes nothing', async () => {
    const db = fakeDb({ highest: 3 });
    await assert.rejects(
      db.service.upsertSetLog('user-1', 'session-1', upsert(5)),
      BadRequestException,
    );
    assert.equal(db.calls.upserts, 0);
  });

  it('keeps saving an extra set that already exists', async () => {
    const db = fakeDb({ highest: 6, existing: true });
    await db.service.upsertSetLog('user-1', 'session-1', upsert(5));
    assert.equal(db.calls.upserts, 1);
  });

  it('removes only the last extra set', async () => {
    const prescribed = fakeDb({ highest: 4 });
    await assert.rejects(
      prescribed.service.deleteSetLog('user-1', 'session-1', 'slot-bench', 3),
      BadRequestException,
    );
    const middle = fakeDb({ highest: 5 });
    await assert.rejects(
      middle.service.deleteSetLog('user-1', 'session-1', 'slot-bench', 4),
      BadRequestException,
    );
    assert.equal(prescribed.calls.deletes + middle.calls.deletes, 0);

    const last = fakeDb({ highest: 5 });
    await last.service.deleteSetLog('user-1', 'session-1', 'slot-bench', 5);
    assert.equal(last.calls.deletes, 1);
  });
});
