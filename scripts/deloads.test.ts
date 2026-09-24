import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { applyDeload, resolveRoutinePlan } from '@sunsteel/contracts';
import {
  routinesPlannedOn,
  type ReminderRoutine,
} from '../src/notifications/push/training-days';
import {
  assertBlockLeavesDeloads,
  assertDeloadDates,
  endedEarlyEndDate,
} from '../src/routines/routine-deloads';
import { toPlanOverrides } from '../src/routines/routine-plan';
import {
  assertDayInPlan,
  progressionRuns,
  sessionTemporaryOverride,
  temporaryOverrideColumns,
} from '../src/workouts/session-training-block';

const TODAY = '2026-10-05';
const block = { id: 'block-1', startDate: '2026-10-01', endDate: '2026-10-14' };

const dates = (startDate: string, endDate: string, extra = {}) =>
  assertDeloadDates({
    startDate,
    endDate,
    today: TODAY,
    overrides: [],
    blocks: [block],
    ...extra,
  });

test('a deload is bounded, starts today or later and stays inside one plan', () => {
  assert.equal(dates('2026-10-05', '2026-10-11')?.id, 'block-1');
  assert.equal(dates('2026-10-15', '2026-10-21'), null);
  assert.throws(() => dates('2026-10-04', '2026-10-06'), BadRequestException);
  assert.throws(() => dates('2026-10-06', '2026-10-05'), BadRequestException);
  // Fifteen days is one too many.
  assert.throws(
    () => dates('2026-10-15', '2026-10-29', { blocks: [] }),
    BadRequestException,
  );
  assert.equal(dates('2026-10-15', '2026-10-28', { blocks: [] }), null);
  // Crossing the block's end, or its start, mixes two plans.
  assert.throws(() => dates('2026-10-12', '2026-10-16'), ConflictException);
  assert.throws(
    () =>
      dates('2026-10-06', '2026-10-09', {
        blocks: [
          { id: 'later', startDate: '2026-10-08', endDate: '2026-10-20' },
        ],
      }),
    ConflictException,
  );
  assert.throws(
    () =>
      dates('2026-10-05', '2026-10-07', {
        overrides: [{ startDate: '2026-10-07', endDate: '2026-10-09' }],
      }),
    ConflictException,
  );
  assert.equal(endedEarlyEndDate(TODAY), '2026-10-04');
});

test('a block write leaves unfinished deloads of other plans alone', () => {
  const deload = {
    startDate: '2026-10-06',
    endDate: '2026-10-10',
    sourceTrainingBlockSeriesId: 'series-1',
  };
  const write = (seriesId: string | null, startDate: string, endDate: string) =>
    assertBlockLeavesDeloads({
      seriesId,
      startDate,
      endDate,
      today: TODAY,
      deloads: [deload],
    });
  // Its own block may be revised around it while it still fits.
  assert.doesNotThrow(() => write('series-1', '2026-10-01', '2026-10-20'));
  assert.throws(
    () => write('series-1', '2026-10-01', '2026-10-08'),
    ConflictException,
  );
  // Another block may not land on it.
  assert.throws(
    () => write(null, '2026-10-09', '2026-10-30'),
    ConflictException,
  );
  assert.doesNotThrow(() => write(null, '2026-10-11', '2026-10-30'));
  // A finished or ended deload no longer holds dates.
  assert.doesNotThrow(() =>
    assertBlockLeavesDeloads({
      seriesId: null,
      startDate: '2026-10-01',
      endDate: '2026-10-30',
      today: TODAY,
      deloads: [{ ...deload, endDate: '2026-10-04' }],
    }),
  );
});

test('the deload in force owns its dates in every resolver', () => {
  const setup = {
    name: 'Deload',
    description: null,
    scheduleMode: 'WEEKLY',
    restDays: [],
    rotationWeekdays: [],
    days: [],
  };
  const routine: ReminderRoutine = {
    id: 'r1',
    name: 'Split',
    scheduleMode: 'WEEKLY',
    isCompleted: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    days: [{ dayOfWeek: 1 }],
    restDays: [],
    rotationWeekdays: [],
    trainingBlocks: [],
    temporaryOverrides: toPlanOverrides([
      {
        id: 'deload-1',
        kind: 'DELOAD',
        startDate: '2026-10-05',
        endDate: '2026-10-11',
        setup,
        days: [{ dayOfWeek: 1 }],
      },
    ]),
  };
  const inDeload = resolveRoutinePlan(routine, '2026-10-05');
  assert.equal(inDeload.override?.id, 'deload-1');
  assert.equal(inDeload.override?.kind, 'DELOAD');
  assert.equal(resolveRoutinePlan(routine, '2026-10-12').override, null);
  // The deload keeps the plan's weekdays, so a reminder still names the day.
  assert.deepEqual(
    routinesPlannedOn({
      date: '2026-10-05',
      routines: [routine],
      overrides: [],
      routineIdsTrainedOnDate: [],
    }),
    ['Split'],
  );
});

test('during a deload only its days start, and outside it none of its days do', () => {
  const deload = { id: 'deload-1', endDate: '2026-10-11' };
  assert.doesNotThrow(() =>
    assertDayInPlan(
      { trainingBlockId: null, temporaryOverrideId: 'deload-1' },
      null,
      deload,
    ),
  );
  assert.throws(
    () =>
      assertDayInPlan(
        { trainingBlockId: 'block-1', temporaryOverrideId: null },
        { id: 'block-1', name: 'Strength', endDate: '2026-10-14' },
        deload,
      ),
    ConflictException,
  );
  assert.throws(
    () =>
      assertDayInPlan(
        { trainingBlockId: null, temporaryOverrideId: 'deload-1' },
        null,
        null,
      ),
    ConflictException,
  );
});

test('a deload session records its deload and never runs progression', () => {
  const columns = temporaryOverrideColumns({ id: 'deload-1', kind: 'DELOAD' });
  assert.deepEqual(sessionTemporaryOverride(columns), {
    id: 'deload-1',
    kind: 'DELOAD',
  });
  assert.equal(progressionRuns(columns), false);
  assert.equal(progressionRuns(temporaryOverrideColumns(null)), true);
  assert.equal(sessionTemporaryOverride(temporaryOverrideColumns(null)), null);
});

test('the shared deload rule is lighter, rounds to the grid and keeps the first half', () => {
  const exercise = (weight: number | null, sets: number) => ({
    exercise: { id: 'e', name: 'Squat' },
    order: 0,
    restSeconds: 90,
    note: null,
    progressionScheme: 'NONE' as const,
    minWeightIncrement: 2.5,
    sets: Array.from({ length: sets }, (_, i) => ({
      setNumber: i + 1,
      repType: 'FIXED' as const,
      reps: 5,
      weight,
      rir: 2,
    })),
  });
  const setup = (exercises: ReturnType<typeof exercise>[]) => ({
    name: 'x',
    description: null,
    scheduleMode: 'WEEKLY' as const,
    restDays: [],
    days: [{ dayOfWeek: 1, name: null, order: 0, exercises }],
  });
  const lighter = applyDeload(setup([exercise(77.5, 4)]), {
    loadReductionPercent: 10,
    setMode: 'HALF',
  });
  assert.deepEqual(
    lighter?.days[0].exercises[0].sets.map((set) => [
      set.setNumber,
      set.weight,
    ]),
    [
      [1, 70],
      [2, 70],
    ],
  );
  // Bodyweight work with nothing to halve cannot be made lighter.
  assert.equal(
    applyDeload(setup([exercise(null, 1)]), {
      loadReductionPercent: 20,
      setMode: 'HALF',
    }),
    null,
  );
});
