import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ROUTINE_VERSION_NAME_MAX,
  ROUTINE_VERSIONS_MAX,
} from '@sunsteel/contracts';
import { DatabaseService } from '../src/database/database.service';
import type { RoutineWithDaysEntity } from '../src/routines/routine.mapper';
import {
  captureRoutineSetup,
  normalizeVersionName,
  readRoutineSetup,
  setupExerciseIds,
  setupToRoutineUpdate,
} from '../src/routines/routine-versions';
import { RoutineVersionsService } from '../src/routines/routine-versions.service';
import { RoutinesService } from '../src/routines/routines.service';

const created = new Date('2026-09-01T10:00:00Z');

function routineEntity(
  overrides: Partial<RoutineWithDaysEntity> = {},
): RoutineWithDaysEntity {
  return {
    id: 'r1',
    userId: 'u1',
    name: 'Upper Lower',
    description: null,
    isPeriodized: false,
    isFavorite: true,
    isCompleted: false,
    scheduleMode: 'WEEKLY',
    restDays: [0, 6],
    rotationWeekdays: [],
    createdAt: created,
    updatedAt: created,
    days: [
      {
        id: 'day-1',
        dayOfWeek: 1,
        name: 'Upper',
        order: 0,
        exercises: [
          {
            id: 're-1',
            order: 0,
            restSeconds: 120,
            note: 'Pause at the chest',
            progressionScheme: 'DOUBLE_PROGRESSION',
            minWeightIncrement: 2.5,
            exercise: { id: 'bench', name: 'Bench Press' },
            sets: [
              {
                setNumber: 1,
                repType: 'RANGE',
                reps: null,
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
    ...overrides,
  } as RoutineWithDaysEntity;
}

test('a captured setup keeps the whole prescription and no ids', () => {
  const setup = captureRoutineSetup(routineEntity());
  assert.deepEqual(setup, {
    name: 'Upper Lower',
    description: null,
    scheduleMode: 'WEEKLY',
    restDays: [0, 6],
    rotationWeekdays: [],
    days: [
      {
        dayOfWeek: 1,
        name: 'Upper',
        order: 0,
        exercises: [
          {
            exercise: { id: 'bench', name: 'Bench Press' },
            order: 0,
            restSeconds: 120,
            note: 'Pause at the chest',
            progressionScheme: 'DOUBLE_PROGRESSION',
            minWeightIncrement: 2.5,
            sets: [
              {
                setNumber: 1,
                repType: 'RANGE',
                reps: null,
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
  });
  assert.equal(JSON.stringify(setup).includes('day-1'), false);
  assert.deepEqual(readRoutineSetup(JSON.parse(JSON.stringify(setup))), setup);
});

test('restoring a setup becomes an ordinary routine update', () => {
  const setup = captureRoutineSetup(routineEntity());
  const update = setupToRoutineUpdate(setup);
  assert.equal(update.name, 'Upper Lower');
  assert.equal(update.description, undefined);
  assert.deepEqual(update.restDays, [0, 6]);
  assert.equal(update.days[0].exercises[0].exerciseId, 'bench');
  assert.equal(update.days[0].exercises[0].sets[0].weight, 80);
  assert.deepEqual(setupExerciseIds(setup), ['bench']);

  assert.deepEqual(update.rotationWeekdays, []);

  const rotation = setupToRoutineUpdate({
    ...setup,
    scheduleMode: 'ROTATION',
    restDays: [3],
    rotationWeekdays: [1, 3, 5],
  });
  assert.deepEqual(rotation.restDays, []);
  assert.deepEqual(rotation.rotationWeekdays, [1, 3, 5]);
  // A version saved before SCHED-06 has no weekdays: the rotation is undated.
  const { rotationWeekdays: _omitted, ...older } = setup;
  void _omitted;
  assert.deepEqual(
    setupToRoutineUpdate({ ...older, scheduleMode: 'ROTATION' })
      .rotationWeekdays,
    [],
  );
  assert.deepEqual(readRoutineSetup(older), older);
});

test('corrupt setups and bad names are refused', () => {
  assert.throws(() => readRoutineSetup(null));
  assert.throws(() => readRoutineSetup({ name: 'x', scheduleMode: 'DAILY' }));
  assert.throws(() =>
    readRoutineSetup({
      name: 'x',
      scheduleMode: 'WEEKLY',
      restDays: [],
      days: [{ exercises: [{ exercise: { id: 'a' }, sets: [{}] }] }],
    }),
  );
  assert.equal(normalizeVersionName('  Strength block  '), 'Strength block');
  assert.equal(normalizeVersionName('   '), null);
  assert.equal(normalizeVersionName(undefined), null);
  assert.throws(
    () => normalizeVersionName('x'.repeat(ROUTINE_VERSION_NAME_MAX + 1)),
    BadRequestException,
  );
});

type VersionRow = {
  id: string;
  routineId: string;
  number: number;
  name: string | null;
  kind: 'SAVED' | 'BEFORE_RESTORE';
  restoredVersionNumber: number | null;
  setup: unknown;
  createdAt: Date;
};

function fakeDb(rows: VersionRow[], catalog = new Set(['bench'])) {
  const routine = routineEntity();
  const updates: unknown[] = [];
  let lastVersionNumber = 0;
  const tx = {
    $queryRaw: async () => [],
    routine: {
      findFirst: async (query: any) =>
        query.where.id === routine.id && query.where.userId === routine.userId
          ? routine
          : null,
      update: async (query: any) => {
        assert.deepEqual(query.data, { lastVersionNumber: { increment: 1 } });
        return { lastVersionNumber: ++lastVersionNumber };
      },
    },
    exercise: {
      count: async (query: any) =>
        query.where.id.in.filter((id: string) => catalog.has(id)).length,
    },
    routineVersion: {
      findMany: async (query: any) =>
        rows
          .filter((row) => row.routineId === query.where.routineId)
          .sort((a, b) => b.number - a.number),
      findFirst: async (query: any) =>
        rows.find(
          (row) =>
            row.id === query.where.id &&
            row.routineId === query.where.routineId,
        ) ?? null,
      count: async (query: any) =>
        rows.filter((row) => row.routineId === query.where.routineId).length,
      create: async (query: any) => {
        const row = {
          id: `v${rows.length + 1}-${query.data.number}`,
          createdAt: new Date(),
          name: null,
          restoredVersionNumber: null,
          ...query.data,
        };
        rows.push(row);
        return row;
      },
      deleteMany: async (query: any) => {
        const before = rows.length;
        const kept = rows.filter(
          (row) =>
            !(
              row.id === query.where.id &&
              row.routineId === query.where.routineId
            ),
        );
        rows.splice(0, rows.length, ...kept);
        return { count: before - kept.length };
      },
    },
  };
  const db = {
    ...tx,
    $transaction: async (run: any) => run(tx),
  } as unknown as DatabaseService;
  const routines = {
    updateInTransaction: async (
      _tx: unknown,
      _userId: string,
      _id: string,
      dto: unknown,
    ) => {
      updates.push(dto);
      return { id: routine.id };
    },
  } as unknown as RoutinesService;
  return { service: new RoutineVersionsService(db, routines), updates };
}

test('saved versions number up and never reuse a deleted number', async () => {
  const rows: VersionRow[] = [];
  const { service } = fakeDb(rows);
  const first = await service.create('u1', 'r1', ' Block A ');
  const second = await service.create('u1', 'r1');
  assert.deepEqual(
    [first.number, first.name, first.kind, second.number, second.name],
    [1, 'Block A', 'SAVED', 2, null],
  );
  assert.equal(first.setup.days[0].exercises[0].exercise.name, 'Bench Press');

  await service.remove('u1', 'r1', second.id);
  const third = await service.create('u1', 'r1');
  assert.equal(third.number, 3);

  const list = await service.list('u1', 'r1');
  assert.deepEqual(
    list.versions.map((version) => version.number),
    [3, 1],
  );
  assert.equal(list.max, ROUTINE_VERSIONS_MAX);
  await assert.rejects(service.remove('u1', 'r1', 'missing'), NotFoundException);
  await assert.rejects(service.list('u2', 'r1'), NotFoundException);
});

test('a routine keeps at most the maximum number of versions', async () => {
  const rows: VersionRow[] = [];
  const { service } = fakeDb(rows);
  for (let index = 0; index < ROUTINE_VERSIONS_MAX; index++) {
    await service.create('u1', 'r1');
  }
  await assert.rejects(service.create('u1', 'r1'), ConflictException);
  await assert.rejects(
    service.restore('u1', 'r1', rows[0].id),
    ConflictException,
  );
});

test('restoring saves the replaced setup first, then applies the version', async () => {
  const rows: VersionRow[] = [];
  const { service, updates } = fakeDb(rows);
  const saved = await service.create('u1', 'r1', 'Block A');

  const result = await service.restore('u1', 'r1', saved.id);
  assert.equal(result.savedVersion.kind, 'BEFORE_RESTORE');
  assert.equal(result.savedVersion.restoredVersionNumber, saved.number);
  assert.equal(result.savedVersion.number, 2);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], setupToRoutineUpdate(saved.setup));
  await assert.rejects(
    service.restore('u1', 'r1', 'missing'),
    NotFoundException,
  );
});

test('a version whose exercise left the catalog is not restored', async () => {
  const rows: VersionRow[] = [];
  const { service, updates } = fakeDb(rows, new Set());
  const saved = await service.create('u1', 'r1');
  await assert.rejects(service.restore('u1', 'r1', saved.id), ConflictException);
  assert.equal(rows.length, 1);
  assert.equal(updates.length, 0);
});
