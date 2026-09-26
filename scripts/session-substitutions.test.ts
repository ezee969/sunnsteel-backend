import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  SessionExerciseSubstitution,
  WorkoutSessionSnapshotV1,
} from '@sunsteel/contracts';

import { DatabaseService } from '../src/database/database.service';
import { sessionContribution } from '../src/workouts/analytics/analytics-contribution';
import {
  excludeSubstitutedSlots,
  expectedExerciseId,
  performedExercise,
  readSubstitutions,
  withoutSubstitution,
  withSubstitution,
} from '../src/workouts/session-substitutions';
import { WorkoutSessionSubstitutionService } from '../src/workouts/services';

const snapshot: WorkoutSessionSnapshotV1 = {
  schemaVersion: 1,
  sessionId: 'session-1',
  sourceRoutineId: 'routine-1',
  sourceRoutineDayId: 'day-1',
  capturedAt: '2026-09-14T08:00:00.000Z',
  provenance: 'CAPTURED',
  notes: null,
  routine: { id: 'routine-1', name: 'Upper' },
  routineDay: {
    id: 'day-1',
    dayOfWeek: 1,
    exercises: [
      {
        id: 'slot-bench',
        order: 0,
        progressionScheme: 'DOUBLE_PROGRESSION',
        minWeightIncrement: 2.5,
        exercise: {
          id: 'bench',
          name: 'Bench Press',
          primaryMuscles: ['PECTORAL'],
          secondaryMuscles: ['TRICEPS'],
        },
        sets: [{ id: 'set-1', setNumber: 1, repType: 'FIXED', reps: 8, weight: 80 }],
      },
      {
        id: 'slot-row',
        order: 1,
        progressionScheme: 'NONE',
        minWeightIncrement: 2.5,
        exercise: {
          id: 'row',
          name: 'Cable Row',
          primaryMuscles: ['LATISSIMUS_DORSI'],
          secondaryMuscles: [],
        },
        sets: [{ id: 'set-2', setNumber: 1, repType: 'FIXED', reps: 10, weight: 50 }],
      },
    ],
  },
};

const pushupsRow = {
  id: 'pushups',
  name: 'Push-ups',
  primaryMuscles: ['PECTORAL' as const],
  secondaryMuscles: ['TRICEPS' as const, 'CORE' as const],
};

const pushups: SessionExerciseSubstitution = {
  routineExerciseId: 'slot-bench',
  exercise: pushupsRow,
  substitutedAt: '2026-09-14T08:05:00.000Z',
};

describe('substitution helpers', () => {
  it('reads valid entries, ignores malformed ones and defaults secondary muscles', () => {
    const read = readSubstitutions([
      pushups,
      { routineExerciseId: 7 },
      'nope',
      {
        routineExerciseId: 'slot-row',
        exercise: { id: 'pulldown', name: 'Lat Pulldown', primaryMuscles: [] },
        substitutedAt: '2026-09-14T08:06:00.000Z',
      },
    ]);
    assert.equal(read.length, 2);
    assert.deepEqual(read[1].exercise.secondaryMuscles, []);
    assert.deepEqual(readSubstitutions(null), []);
  });

  it('resolves the performed and expected exercise for a slot', () => {
    const [bench, row] = snapshot.routineDay.exercises;
    assert.equal(performedExercise(bench, [pushups]).id, 'pushups');
    assert.equal(performedExercise(row, [pushups]).id, 'row');
    assert.equal(
      expectedExerciseId({ id: 'slot-bench', exerciseId: 'bench' }, [pushups]),
      'pushups',
    );
    assert.equal(
      expectedExerciseId({ id: 'slot-row', exerciseId: 'row' }, [pushups]),
      'row',
    );
  });

  it('keeps one swap per slot and removes it on revert', () => {
    const replaced = withSubstitution([pushups], {
      ...pushups,
      exercise: { ...pushups.exercise, id: 'dips', name: 'Chest Dips' },
    });
    assert.equal(replaced.length, 1);
    assert.equal(replaced[0].exercise.id, 'dips');
    assert.deepEqual(withoutSubstitution(replaced, 'slot-bench'), []);
  });

  it('keeps swapped slots out of progression', () => {
    const logs = [
      { routineExerciseId: 'slot-bench', setNumber: 1 },
      { routineExerciseId: 'slot-row', setNumber: 1 },
    ];
    assert.deepEqual(excludeSubstitutedSlots(logs, [pushups]), [logs[1]]);
  });
});

describe('analytics credit the exercise performed', () => {
  const endedAt = new Date('2026-09-14T09:00:00.000Z');
  const log = {
    id: 'log-1',
    exerciseId: 'pushups',
    routineExerciseId: 'slot-bench',
    sourceRoutineExerciseId: 'slot-bench',
    weight: 10,
    reps: 12,
    isCompleted: true,
    completedAt: new Date('2026-09-14T08:10:00.000Z'),
  };

  it('uses the substitute muscles and name for a swapped slot', () => {
    const result = sessionContribution([log], snapshot, endedAt, [pushups]);
    assert.deepEqual(
      result.muscles.map(([muscle]) => muscle),
      ['CORE', 'PECTORAL', 'TRICEPS'],
    );
    assert.equal(result.records[0].exerciseName, 'Push-ups');
  });

  it('keeps the prescribed exercise when nothing was swapped', () => {
    const result = sessionContribution(
      [{ ...log, exerciseId: 'bench' }],
      snapshot,
      endedAt,
    );
    assert.deepEqual(
      result.muscles.map(([muscle]) => muscle),
      ['PECTORAL', 'TRICEPS'],
    );
    assert.equal(result.records[0].exerciseName, 'Bench Press');
  });
});

function fakeDb(
  options: {
    missing?: boolean;
    status?: string;
    completed?: number;
    substitutions?: unknown;
    routineRows?: number;
  } = {},
) {
  let stored: unknown = options.substitutions ?? [];
  const calls = {
    deleteMany: [] as unknown[],
    updateMany: [] as unknown[],
    writes: 0,
  };
  const entity = () => ({
    id: 'session-1',
    userId: 'user-1',
    sourceRoutineId: 'routine-1',
    sourceRoutineDayId: 'day-1',
    snapshot: { payload: snapshot },
    routineId: 'routine-1',
    routineDayId: 'day-1',
    status: options.status ?? 'IN_PROGRESS',
    startedAt: new Date('2026-09-14T08:00:00.000Z'),
    endedAt: null,
    durationSec: null,
    notes: null,
    lastActivityAt: null,
    exerciseSubstitutions: stored,
    createdAt: new Date('2026-09-14T08:00:00.000Z'),
    updatedAt: new Date('2026-09-14T08:00:00.000Z'),
    routine: null,
    routineDay: null,
    setLogs: [],
  });
  const tx = {
    $queryRaw: async () => [],
    workoutSession: {
      findFirst: async () =>
        options.missing
          ? null
          : {
              id: 'session-1',
              status: options.status ?? 'IN_PROGRESS',
              exerciseSubstitutions: stored,
            },
      findUniqueOrThrow: async () => entity(),
      update: async (args: { data: { exerciseSubstitutions: unknown } }) => {
        calls.writes += 1;
        stored = args.data.exerciseSubstitutions;
        return {};
      },
    },
    setLog: {
      count: async () => options.completed ?? 0,
      deleteMany: async (args: unknown) => {
        calls.deleteMany.push(args);
        return { count: 1 };
      },
    },
    exercise: {
      // EXER-06: the lookup is scoped to what the owner may use.
      findFirst: async ({ where }: { where: { id: string; OR: unknown } }) =>
        where.id === 'pushups' && where.OR ? pushupsRow : null,
    },
    routineExercise: {
      updateMany: async (args: unknown) => {
        calls.updateMany.push(args);
        return { count: options.routineRows ?? 1 };
      },
    },
  };
  const db = {
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  };
  return {
    service: new WorkoutSessionSubstitutionService(db as unknown as DatabaseService),
    calls,
    stored: () => stored,
  };
}

describe('WorkoutSessionSubstitutionService', () => {
  const swap = { exerciseId: 'pushups' };

  it('only swaps slots of the owner’s active session', async () => {
    await assert.rejects(
      fakeDb({ missing: true }).service.substitute('user-1', 'session-1', 'slot-bench', swap),
      NotFoundException,
    );
    await assert.rejects(
      fakeDb({ status: 'COMPLETED' }).service.substitute('user-1', 'session-1', 'slot-bench', swap),
      BadRequestException,
    );
    await assert.rejects(
      fakeDb().service.substitute('user-1', 'session-1', 'slot-unknown', swap),
      NotFoundException,
    );
  });

  it('refuses once the slot has completed work, and writes nothing', async () => {
    const db = fakeDb({ completed: 1 });
    await assert.rejects(
      db.service.substitute('user-1', 'session-1', 'slot-bench', swap),
      ConflictException,
    );
    assert.equal(db.calls.writes, 0);
    assert.equal(db.calls.deleteMany.length, 0);
  });

  it('records the swap with the catalog muscles and clears the slot’s drafts', async () => {
    const db = fakeDb();
    const result = await db.service.substitute('user-1', 'session-1', 'slot-bench', swap);
    const [saved] = readSubstitutions(db.stored());
    assert.equal(saved.routineExerciseId, 'slot-bench');
    assert.deepEqual(saved.exercise.secondaryMuscles, ['TRICEPS', 'CORE']);
    assert.match(JSON.stringify(db.calls.deleteMany[0]), /"isCompleted":false/);
    assert.match(JSON.stringify(db.calls.deleteMany[0]), /slot-bench/);
    assert.equal(result.routineUpdated, false);
    assert.equal(db.calls.updateMany.length, 0);
    assert.equal(result.session.exerciseSubstitutions?.[0].exercise.id, 'pushups');
  });

  it('updates the routine only when asked and when the slot still exists', async () => {
    const applied = fakeDb();
    const result = await applied.service.substitute('user-1', 'session-1', 'slot-bench', {
      ...swap,
      applyToRoutine: true,
    });
    assert.equal(result.routineUpdated, true);
    assert.match(JSON.stringify(applied.calls.updateMany[0]), /"userId":"user-1"/);
    assert.match(JSON.stringify(applied.calls.updateMany[0]), /"exerciseId":"pushups"/);

    const gone = fakeDb({ routineRows: 0 });
    const missing = await gone.service.substitute('user-1', 'session-1', 'slot-bench', {
      ...swap,
      applyToRoutine: true,
    });
    assert.equal(missing.routineUpdated, false);
  });

  it('treats the prescribed exercise, or a revert, as clearing the swap', async () => {
    const back = fakeDb({ substitutions: [pushups] });
    await back.service.substitute('user-1', 'session-1', 'slot-bench', { exerciseId: 'bench' });
    assert.deepEqual(back.stored(), []);

    const reverted = fakeDb({ substitutions: [pushups] });
    const result = await reverted.service.revert('user-1', 'session-1', 'slot-bench');
    assert.deepEqual(reverted.stored(), []);
    assert.deepEqual(result.session.exerciseSubstitutions, []);
  });

  it('rejects an exercise that is not in the catalog', async () => {
    await assert.rejects(
      fakeDb().service.substitute('user-1', 'session-1', 'slot-bench', { exerciseId: 'nope' }),
      NotFoundException,
    );
  });
});
