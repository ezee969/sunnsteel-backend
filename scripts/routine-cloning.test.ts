import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import type { RoutineVersionSetup } from '@sunsteel/contracts';
import {
  readCloneSource,
  setupToClonedRoutine,
} from '../src/routines/routine-cloning';

const setup: RoutineVersionSetup = {
  name: 'Upper / Lower',
  description: 'Four days, alternating.',
  scheduleMode: 'WEEKLY',
  restDays: [0, 3],
  rotationWeekdays: [],
  days: [
    {
      dayOfWeek: 1,
      name: 'Upper',
      order: 0,
      exercises: [
        {
          exercise: { id: 'exercise-1', name: 'Bench Press' },
          order: 0,
          restSeconds: 180,
          note: 'Pause on the chest.',
          progressionScheme: 'DOUBLE_PROGRESSION',
          minWeightIncrement: 2.5,
          sets: [
            {
              setNumber: 1,
              repType: 'RANGE',
              minReps: 6,
              maxReps: 8,
              weight: 80,
              rir: 2,
            },
          ],
        },
      ],
    },
  ],
};

describe('ROUT-05 clone source', () => {
  it('takes exactly one source and states why when it cannot', () => {
    assert.deepEqual(readCloneSource({ token: ' abc123 ' }), {
      kind: 'LINK',
      token: 'abc123',
    });
    assert.deepEqual(readCloneSource({ routineId: 'routine-1' }), {
      kind: 'VISIBILITY',
      routineId: 'routine-1',
    });

    // Both at once is refused rather than resolved by preference: a link and a
    // visibility read answer different questions about who may read it.
    assert.throws(
      () => readCloneSource({ token: 'abc123', routineId: 'routine-1' }),
      BadRequestException,
    );
    assert.throws(() => readCloneSource({}), BadRequestException);
    assert.throws(() => readCloneSource({ token: '   ' }), BadRequestException);
  });
});

describe('ROUT-05 cloned routine', () => {
  it('copies the whole prescription, loads and progression included', () => {
    const clone = setupToClonedRoutine(setup);

    assert.equal(clone.name, 'Upper / Lower');
    assert.equal(clone.description, 'Four days, alternating.');
    assert.equal(clone.scheduleMode, 'WEEKLY');
    assert.deepEqual(clone.restDays, [0, 3]);
    assert.deepEqual(clone.days[0].exercises[0], {
      exerciseId: 'exercise-1',
      order: 0,
      restSeconds: 180,
      note: 'Pause on the chest.',
      progressionScheme: 'DOUBLE_PROGRESSION',
      minWeightIncrement: 2.5,
      sets: [
        {
          setNumber: 1,
          repType: 'RANGE',
          minReps: 6,
          maxReps: 8,
          weight: 80,
          rir: 2,
        },
      ],
    });
  });

  it('carries nothing but the prescription and nothing that would republish it', () => {
    const clone = setupToClonedRoutine(setup) as Record<string, unknown>;

    // The clone is a create payload, so what it does NOT say is what matters:
    // visibility, links, versions, favourite and completed state all start
    // from the routine defaults, and no training can travel in this shape.
    assert.deepEqual(Object.keys(clone).sort(), [
      'days',
      'description',
      'isPeriodized',
      'name',
      'restDays',
      'rotationWeekdays',
      'scheduleMode',
    ]);
    assert.equal(clone.isPeriodized, false);
    const serialized = JSON.stringify(clone);
    for (const forbidden of [
      'visibility',
      'session',
      'record',
      'log',
      'userId',
      'token',
    ]) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `a clone must not carry ${forbidden}`,
      );
    }
  });

  it('keeps a rotation a rotation and drops the weekly fields it cannot use', () => {
    const rotation = setupToClonedRoutine({
      ...setup,
      scheduleMode: 'ROTATION',
      restDays: [0, 3],
      rotationWeekdays: [1, 3, 5],
      days: [{ ...setup.days[0], dayOfWeek: null }],
    });

    assert.equal(rotation.scheduleMode, 'ROTATION');
    assert.deepEqual(rotation.rotationWeekdays, [1, 3, 5]);
    // SCHED-07 rest days belong to weekly routines only.
    assert.deepEqual(rotation.restDays, []);
    assert.equal(rotation.days[0].dayOfWeek, null);
  });
});
