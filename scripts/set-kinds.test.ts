import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyDeload,
  type RoutineVersionSetup,
  type SetKind,
  type WorkoutSessionSnapshotV1,
} from '@sunsteel/contracts';

import {
  type AnalyticsLog,
  sessionContribution,
} from '../src/workouts/analytics/analytics-contribution';
import { recordValues } from '../src/workouts/live-personal-records';
import { buildProgressionOutcome } from '../src/workouts/progression-changes';
import { prescribedSetKind } from '../src/workouts/session-extra-sets';
import {
  repTargetSignal,
  type TrainingSignalSetRow,
} from '../src/workouts/workout-training-signals.service';

const endedAt = new Date('2026-09-24T10:00:00.000Z');

const snapshot = (
  kinds: Array<SetKind | undefined>,
): WorkoutSessionSnapshotV1 =>
  ({
    schemaVersion: 1,
    sessionId: 'session',
    sourceRoutineId: 'routine',
    sourceRoutineDayId: 'day',
    capturedAt: '2026-09-24T09:00:00.000Z',
    provenance: 'CAPTURED',
    notes: null,
    routine: { id: 'routine', name: 'Upper' },
    routineDay: {
      id: 'day',
      dayOfWeek: 1,
      exercises: [
        {
          id: 'rx',
          order: 0,
          restSeconds: 90,
          progressionScheme: 'NONE',
          minWeightIncrement: 2.5,
          exercise: {
            id: 'bench',
            name: 'Bench Press',
            primaryMuscles: ['PECTORAL'],
          },
          sets: kinds.map((kind, index) => ({
            id: `set-${index + 1}`,
            setNumber: index + 1,
            repType: 'FIXED',
            reps: 8,
            weight: 80,
            ...(kind ? { kind } : {}),
          })),
        },
      ],
    },
  }) as unknown as WorkoutSessionSnapshotV1;

const analyticsLog = (
  id: string,
  weight: number,
  reps: number,
  kind?: SetKind,
): AnalyticsLog => ({
  id,
  exerciseId: 'bench',
  routineExerciseId: 'rx',
  sourceRoutineExerciseId: 'rx',
  weight,
  reps,
  isCompleted: true,
  completedAt: endedAt,
  kind,
});

describe('warm-ups never count as work (LIVE-12)', () => {
  it('leaves warm-ups out of volume, sets, muscles and records', () => {
    const result = sessionContribution(
      [
        analyticsLog('w', 200, 10, 'WARMUP'),
        analyticsLog('a', 80, 8),
        analyticsLog('d', 60, 10, 'DROP'),
      ],
      snapshot(['WARMUP', 'WORKING', 'DROP']),
      endedAt,
    );
    assert.equal(result.completedSets, 2);
    assert.equal(result.volumeKg, 80 * 8 + 60 * 10);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].setLogId, 'a');
  });

  it('gives a warm-up no record value', () => {
    const warmup = recordValues({
      isCompleted: true,
      weight: 100,
      reps: 5,
      kind: 'WARMUP',
    });
    assert.deepEqual(Object.values(warmup), [null, null, null, null]);
    assert.equal(
      recordValues({ isCompleted: true, weight: 100, reps: 5 }).WEIGHT,
      100,
    );
  });
});

const exercise = (
  kinds: SetKind[],
  progressionScheme:
    | 'NONE'
    | 'DOUBLE_PROGRESSION'
    | 'DYNAMIC_DOUBLE_PROGRESSION' = 'DOUBLE_PROGRESSION',
) => ({
  id: 'rx',
  exerciseId: 'bench',
  exercise: { name: 'Bench Press' },
  progressionScheme,
  minWeightIncrement: 2.5,
  sets: kinds.map((kind, index) => ({
    setNumber: index + 1,
    repType: 'FIXED' as const,
    reps: 8,
    weight: kind === 'WARMUP' ? 40 : 80,
    kind,
  })),
});

const log = (
  setNumber: number,
  reps: number,
  weight: number,
  isCompleted = true,
  kind?: SetKind,
) => ({
  routineExerciseId: 'rx',
  setNumber,
  reps,
  weight,
  isCompleted,
  kind,
});

const updated = (outcome: ReturnType<typeof buildProgressionOutcome>) =>
  outcome.updates.map((update) => [update.setNumber, update.newWeight]);

describe('progression reads only working and done optional sets (LIVE-12)', () => {
  it('advances the working sets and leaves a warm-up at its load', () => {
    const outcome = buildProgressionOutcome(
      [exercise(['WARMUP', 'WORKING', 'WORKING'])],
      [log(1, 3, 40), log(2, 8, 80), log(3, 8, 80)],
    );
    assert.deepEqual(updated(outcome), [
      [2, 82.5],
      [3, 82.5],
    ]);
    assert.deepEqual(
      outcome.changes[0].sets.map((set) => set.setNumber),
      [2, 3],
    );
  });

  it('never lets a short warm-up or drop set block double progression', () => {
    const outcome = buildProgressionOutcome(
      [exercise(['WARMUP', 'WORKING', 'DROP'])],
      [log(1, 2, 40), log(2, 8, 80), log(3, 4, 60)],
    );
    assert.deepEqual(updated(outcome), [[2, 82.5]]);
  });

  it('skips an optional set that was not done, and holds one done short', () => {
    const skipped = buildProgressionOutcome(
      [exercise(['WORKING', 'OPTIONAL'])],
      [log(1, 8, 80)],
    );
    assert.deepEqual(updated(skipped), [[1, 82.5]]);

    const short = buildProgressionOutcome(
      [exercise(['WORKING', 'OPTIONAL'])],
      [log(1, 8, 80), log(2, 5, 80)],
    );
    assert.deepEqual(short.changes, []);
    assert.deepEqual(updated(short), [
      [1, 80],
      [2, 80],
    ]);
  });

  it('follows a kind changed during the workout', () => {
    const outcome = buildProgressionOutcome(
      [exercise(['WORKING', 'WORKING'], 'NONE')],
      [log(1, 8, 60, true, 'WARMUP'), log(2, 8, 90)],
    );
    assert.deepEqual(updated(outcome), [[2, 90]]);
  });
});

describe('rep-target signals skip drop sets (LIVE-12)', () => {
  it('counts only a working set against its target', () => {
    const row = (setNumber: number, reps: number, kind?: SetKind) =>
      ({
        sessionId: 's',
        status: 'COMPLETED',
        endedAt,
        isDeload: false,
        exerciseId: 'bench',
        exerciseName: 'Bench Press',
        slotId: 'rx',
        setNumber,
        reps,
        weight: 80,
        rpe: null,
        kind,
      }) as TrainingSignalSetRow;
    const floors = new Map([
      [
        's',
        new Map([
          ['rx:1', 8],
          ['rx:2', 8],
        ]),
      ],
    ]);
    const result = repTargetSignal(
      [row(1, 8), row(2, 3, 'DROP')],
      floors,
      () => 'recent',
    );
    assert.equal(result.recent.targetedSets, 1);
    assert.equal(result.recent.shortSets, 0);
  });
});

describe('a new set log starts as its prescription (LIVE-12)', () => {
  it('reads the snapshot, then the live routine, and defaults to working', () => {
    const payload = snapshot(['WARMUP', undefined]);
    assert.equal(prescribedSetKind(payload, 'rx', 1, []), 'WARMUP');
    assert.equal(prescribedSetKind(payload, 'rx', 2, []), 'WORKING');
    assert.equal(prescribedSetKind(payload, 'rx', 3, []), 'WORKING');
    assert.equal(
      prescribedSetKind(null, 'rx', 1, [{ setNumber: 1, kind: 'DROP' }]),
      'DROP',
    );
  });
});

describe('a half-sets deload keeps the warm-ups (LIVE-12)', () => {
  it('halves the other sets and renumbers in order', () => {
    const setup = {
      name: 'Upper',
      scheduleMode: 'WEEKLY',
      restDays: [],
      days: [
        {
          dayOfWeek: 1,
          name: null,
          order: 0,
          exercises: [
            {
              exercise: { id: 'bench', name: 'Bench Press' },
              order: 0,
              restSeconds: 90,
              note: null,
              progressionScheme: 'NONE',
              minWeightIncrement: 2.5,
              sets: (['WARMUP', 'WARMUP', 'WORKING', 'WORKING', 'WORKING', 'WORKING'] as SetKind[]).map(
                (kind, index) => ({
                  setNumber: index + 1,
                  repType: 'FIXED',
                  reps: 8,
                  weight: 80,
                  kind,
                }),
              ),
            },
          ],
        },
      ],
    } as unknown as RoutineVersionSetup;
    const lighter = applyDeload(setup, {
      loadReductionPercent: 0,
      setMode: 'HALF',
    });
    const sets = lighter!.days[0].exercises[0].sets;
    assert.deepEqual(
      sets.map((set) => [set.setNumber, set.kind]),
      [
        [1, 'WARMUP'],
        [2, 'WARMUP'],
        [3, 'WORKING'],
        [4, 'WORKING'],
      ],
    );
  });
});
