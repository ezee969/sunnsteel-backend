import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { resolveRoutinePlan } from '@sunsteel/contracts';
import {
  routinesPlannedOn,
  type ReminderRoutine,
} from '../src/notifications/push/training-days';
import { toPlanBlocks } from '../src/routines/routine-plan';
import {
  assertDayInPlan,
  sessionTrainingBlock,
  trainingBlockColumns,
} from '../src/workouts/session-training-block';

// 2026-10-05 is a Monday (1); 2026-10-07 a Wednesday (3).
const MONDAY_IN_BLOCK = '2026-10-05';
const WEDNESDAY_IN_BLOCK = '2026-10-07';
const MONDAY_AFTER_BLOCK = '2026-10-19';

const setup = (overrides: Record<string, unknown> = {}) => ({
  name: 'Block setup',
  description: null,
  scheduleMode: 'WEEKLY',
  restDays: [5],
  rotationWeekdays: [],
  days: [],
  ...overrides,
});

const block = (overrides: Record<string, unknown> = {}) => ({
  id: 'revision-2',
  seriesId: 'series-1',
  revision: 2,
  name: 'Strength',
  startDate: '2026-10-01',
  endDate: '2026-10-14',
  setup: setup(),
  days: [{ dayOfWeek: 3 }],
  ...overrides,
});

const routine = (
  overrides: Partial<ReminderRoutine> = {},
): ReminderRoutine => ({
  id: 'routine-1',
  name: 'Upper / Lower',
  scheduleMode: 'WEEKLY',
  isCompleted: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  days: [{ dayOfWeek: 1 }],
  restDays: [],
  rotationWeekdays: [],
  trainingBlocks: toPlanBlocks([block()]),
  ...overrides,
});

const plannedOn = (date: string, routines: ReminderRoutine[]) =>
  routinesPlannedOn({
    date,
    routines,
    overrides: [],
    routineIdsTrainedOnDate: [],
  });

test('the active block decides a date, the baseline every other date', () => {
  const r = routine();
  const inBlock = resolveRoutinePlan(r, MONDAY_IN_BLOCK);
  assert.equal(inBlock.block?.name, 'Strength');
  assert.equal(inBlock.block?.revision, 2);
  assert.deepEqual(inBlock.days, [{ dayOfWeek: 3 }]);
  assert.deepEqual(inBlock.restDays, [5]);

  const after = resolveRoutinePlan(r, MONDAY_AFTER_BLOCK);
  assert.equal(after.block, null);
  assert.deepEqual(after.days, [{ dayOfWeek: 1 }]);

  // Both ends of the block are inclusive.
  assert.equal(resolveRoutinePlan(r, '2026-10-01').block?.id, 'revision-2');
  assert.equal(resolveRoutinePlan(r, '2026-10-14').block?.id, 'revision-2');
  assert.equal(resolveRoutinePlan(r, '2026-10-15').block, null);
});

test('reminders follow the block: its weekdays train, the baseline ones do not', () => {
  const routines = [routine()];
  assert.deepEqual(plannedOn(WEDNESDAY_IN_BLOCK, routines), ['Upper / Lower']);
  assert.deepEqual(plannedOn(MONDAY_IN_BLOCK, routines), []);
  assert.deepEqual(plannedOn(MONDAY_AFTER_BLOCK, routines), ['Upper / Lower']);
});

test('a rotation block plans its own training weekdays', () => {
  const routines = [
    routine({
      trainingBlocks: toPlanBlocks([
        block({
          setup: setup({
            scheduleMode: 'ROTATION',
            restDays: [3],
            rotationWeekdays: [1, 4],
          }),
          days: [{ dayOfWeek: null }, { dayOfWeek: null }],
        }),
      ]),
    }),
  ];
  const plan = resolveRoutinePlan(routines[0], MONDAY_IN_BLOCK);
  assert.equal(plan.scheduleMode, 'ROTATION');
  // A rotation has no rest days, whatever the setup carried.
  assert.deepEqual(plan.restDays, []);
  assert.deepEqual(plannedOn(MONDAY_IN_BLOCK, routines), ['Upper / Lower']);
  assert.deepEqual(plannedOn(WEDNESDAY_IN_BLOCK, routines), []);
});

test('only a day of the plan in force may start', () => {
  const active = { id: 'revision-2', name: 'Strength', endDate: '2026-10-14' };
  assert.doesNotThrow(() =>
    assertDayInPlan({ trainingBlockId: 'revision-2' }, active),
  );
  assert.throws(
    () => assertDayInPlan({ trainingBlockId: null }, active),
    ConflictException,
  );
  // A superseded revision's day is not the active block's.
  assert.throws(
    () => assertDayInPlan({ trainingBlockId: 'revision-1' }, active),
    ConflictException,
  );
  assert.doesNotThrow(() => assertDayInPlan({ trainingBlockId: null }, null));
  assert.throws(
    () => assertDayInPlan({ trainingBlockId: 'revision-2' }, null),
    ConflictException,
  );
});

test('a session records the block it trained, and a baseline session none', () => {
  const trained = {
    id: 'revision-2',
    seriesId: 'series-1',
    revision: 2,
    name: 'Strength',
  };
  const columns = trainingBlockColumns(trained);
  assert.deepEqual(sessionTrainingBlock(columns), trained);
  assert.equal(sessionTrainingBlock(trainingBlockColumns(null)), null);
});
