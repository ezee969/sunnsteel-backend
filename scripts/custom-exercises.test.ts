import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CUSTOM_EXERCISES_MAX,
  customExerciseProblem,
  type CustomExerciseInput,
  type RoutineVersionSetup,
} from '@sunsteel/contracts';

import {
  customExerciseData,
  isNameTaken,
  mergeCustomExercise,
} from '../src/exercises/custom-exercise-rules';
import { CustomExercisesService } from '../src/exercises/custom-exercises.service';
import {
  assertUsableExercises,
  unusableExerciseIds,
  usableExerciseWhere,
} from '../src/exercises/exercise-access';
import { mapExercise } from '../src/exercises/exercises.service';

const input = (over: Partial<CustomExerciseInput> = {}): CustomExerciseInput => ({
  name: '  Landmine   Press ',
  primaryMuscles: ['PECTORAL'],
  secondaryMuscles: ['TRICEPS'],
  equipmentRequired: ['bench', 'barbell'],
  movementPattern: 'VERTICAL_PUSH',
  mechanic: 'COMPOUND',
  note: '  Elbows in.  ',
  ...over,
});

describe('custom exercise rules (EXER-06)', () => {
  it('stores a normalized name, a trimmed note and the primary implement', () => {
    const data = customExerciseData(input());
    assert.equal(data.name, 'Landmine Press');
    assert.equal(data.note, 'Elbows in.');
    assert.equal(data.equipment, 'barbell');
    assert.equal(customExerciseData(input({ note: '   ' })).note, null);
  });

  it('refuses an incomplete exercise with its first problem', () => {
    assert.equal(customExerciseProblem(input({ name: '  ' })), 'NAME_REQUIRED');
    assert.equal(customExerciseProblem(input({ name: 'x'.repeat(61) })), 'NAME_TOO_LONG');
    assert.equal(customExerciseProblem(input({ primaryMuscles: [] })), 'PRIMARY_MUSCLE_REQUIRED');
    assert.equal(
      customExerciseProblem(input({ secondaryMuscles: ['PECTORAL'] })),
      'MUSCLE_LISTED_TWICE',
    );
    assert.equal(customExerciseProblem(input({ equipmentRequired: [] })), 'EQUIPMENT_REQUIRED');
    assert.equal(customExerciseProblem(input({ note: 'x'.repeat(501) })), 'NOTE_TOO_LONG');
    assert.equal(customExerciseProblem(input()), null);
  });

  it('keeps what a patch omits and clears what it sends as null', () => {
    const stored = { ...customExerciseData(input()) };
    const merged = mergeCustomExercise(stored, { name: 'Z Press', movementPattern: null });
    assert.equal(merged.name, 'Z Press');
    assert.equal(merged.movementPattern, null);
    assert.deepEqual(merged.primaryMuscles, ['PECTORAL']);
    assert.equal(merged.note, 'Elbows in.');
  });

  it('compares names ignoring case and spacing', () => {
    assert.equal(isNameTaken('bench  PRESS', ['Bench Press']), true);
    assert.equal(isNameTaken('Bench Pressing', ['Bench Press']), false);
  });

  it('serves a custom exercise without its owner, flagged and with its note', () => {
    const row = {
      id: 'c1',
      name: 'Landmine Press',
      primaryMuscles: ['PECTORAL'],
      secondaryMuscles: [],
      equipment: 'barbell',
      movementPattern: null,
      mechanic: null,
      equipmentRequired: ['barbell'],
      substitutionGroup: null,
      instructions: [],
      mediaUrl: null,
      ownerId: 'user-1',
      note: 'Elbows in.',
      archivedAt: null,
      createdAt: new Date('2026-09-25T10:00:00.000Z'),
      updatedAt: new Date('2026-09-25T10:00:00.000Z'),
    } as unknown as Parameters<typeof mapExercise>[0];
    const exercise = mapExercise(row, true);
    assert.equal('ownerId' in exercise, false);
    assert.equal(exercise.isCustom, true);
    assert.equal(exercise.note, 'Elbows in.');
    assert.equal(exercise.inUse, true);
  });
});

describe('who may use an exercise (EXER-06)', () => {
  const db = (rows: Array<{ id: string; ownerId: string | null }>) => ({
    exercise: {
      findMany: async ({ where }: any) =>
        rows.filter(
          (row) =>
            where.id.in.includes(row.id) &&
            where.OR.some((o: any) => o.ownerId === row.ownerId),
        ),
    },
  });
  const rows = [
    { id: 'catalog', ownerId: null },
    { id: 'mine', ownerId: 'me' },
    { id: 'theirs', ownerId: 'them' },
  ];

  it('is the catalog and the member own, never another member custom', async () => {
    assert.deepEqual(usableExerciseWhere('me'), {
      OR: [{ ownerId: null }, { ownerId: 'me' }],
    });
    assert.deepEqual(
      await unusableExerciseIds(db(rows) as any, 'me', ['catalog', 'mine', 'theirs', 'mine']),
      ['theirs'],
    );
    await assertUsableExercises(db(rows) as any, 'me', ['catalog', 'mine']);
    await assert.rejects(
      assertUsableExercises(db(rows) as any, 'me', ['theirs']),
      /Exercise not found/,
    );
  });
});

function fakeDb(state: {
  exercises: Array<Record<string, any>>;
  routineUses?: string[];
  logUses?: string[];
}) {
  const created: Array<Record<string, any>> = [];
  const deleted: string[] = [];
  const tx: any = {
    exercise: {
      count: async ({ where }: any) =>
        state.exercises.filter((e) => e.ownerId === where.ownerId).length,
      findFirst: async ({ where }: any) => {
        if (where.name) {
          const key = where.name.equals.toLowerCase();
          return (
            state.exercises.find(
              (e) =>
                e.name.toLowerCase() === key &&
                (e.ownerId === null || e.ownerId === where.OR[1].ownerId) &&
                e.id !== where.NOT?.id,
            ) ?? null
          );
        }
        return (
          state.exercises.find(
            (e) => e.id === where.id && e.ownerId === where.ownerId,
          ) ?? null
        );
      },
      findMany: async ({ where }: any) =>
        state.exercises.filter((e) =>
          where.id
            ? where.id.in.includes(e.id)
            : e.ownerId === null || e.ownerId === where.OR[1].ownerId,
        ),
      create: async ({ data }: any) => {
        const row = {
          id: `new-${created.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          substitutionGroup: null,
          instructions: [],
          mediaUrl: null,
          note: null,
          archivedAt: null,
          ...data,
        };
        created.push(row);
        state.exercises.push(row);
        return row;
      },
      delete: async ({ where }: any) => {
        deleted.push(where.id);
      },
    },
    routineExercise: {
      groupBy: async ({ where }: any) =>
        (state.routineUses ?? [])
          .filter((id) => where.exerciseId.in.includes(id))
          .map((exerciseId) => ({ exerciseId })),
    },
    setLog: {
      groupBy: async ({ where }: any) =>
        (state.logUses ?? [])
          .filter((id) => where.exerciseId.in.includes(id))
          .map((exerciseId) => ({ exerciseId })),
    },
  };
  const db: any = { ...tx, $transaction: (fn: any) => fn(tx) };
  return { db, created, deleted };
}

const custom = (id: string, ownerId: string, name: string, extra = {}) => ({
  id,
  ownerId,
  name,
  primaryMuscles: ['PECTORAL'],
  secondaryMuscles: [],
  equipment: 'barbell',
  equipmentRequired: ['barbell'],
  movementPattern: null,
  mechanic: null,
  note: 'private',
  ...extra,
});

describe('the custom exercise service (EXER-06)', () => {
  it('refuses a name the member or the catalog already has', async () => {
    const { db } = fakeDb({
      exercises: [
        { id: 'b', ownerId: null, name: 'Bench Press' },
        custom('m', 'me', 'Landmine Press'),
      ],
    });
    const service = new CustomExercisesService(db);
    await assert.rejects(service.create('me', input({ name: 'bench press' })), /NAME_TAKEN/);
    await assert.rejects(service.create('me', input()), /NAME_TAKEN/);
    const created = await service.create('me', input({ name: 'Zercher Squat' }));
    assert.equal(created.name, 'Zercher Squat');
    assert.equal(created.isCustom, true);
  });

  it('stops at the cap, archived ones counted', async () => {
    const exercises = Array.from({ length: CUSTOM_EXERCISES_MAX }, (_, i) =>
      custom(`c${i}`, 'me', `Mine ${i}`, i === 0 ? { archivedAt: new Date() } : {}),
    );
    const { db } = fakeDb({ exercises });
    await assert.rejects(
      new CustomExercisesService(db).create('me', input({ name: 'One more' })),
      /LIMIT_REACHED/,
    );
  });

  it('deletes only an exercise nothing uses, and only its own', async () => {
    const { db, deleted } = fakeDb({
      exercises: [custom('used', 'me', 'Used'), custom('free', 'me', 'Free'), custom('x', 'them', 'Theirs')],
      logUses: ['used'],
    });
    const service = new CustomExercisesService(db);
    await assert.rejects(service.remove('me', 'used'), /IN_USE/);
    await assert.rejects(service.remove('me', 'x'), /Exercise not found/);
    await service.remove('me', 'free');
    assert.deepEqual(deleted, ['free']);
  });
});

describe('cloning a routine that uses custom exercises (EXER-06)', () => {
  const setup = (ids: string[]): RoutineVersionSetup =>
    ({
      name: 'Theirs',
      days: [
        {
          exercises: ids.map((id) => ({ exercise: { id, name: id }, sets: [] })),
        },
      ],
    }) as unknown as RoutineVersionSetup;
  const ids = (s: RoutineVersionSetup) =>
    s.days.flatMap((day) => day.exercises.map((e) => e.exercise.id));

  it('copies another member custom exercise without its note', async () => {
    const { db, created } = fakeDb({
      exercises: [
        { id: 'cat', ownerId: null, name: 'Squat' },
        custom('theirs', 'them', 'Landmine Press'),
      ],
    });
    const next = await new CustomExercisesService(db).adoptForClone('me', setup(['cat', 'theirs']));
    assert.equal(created.length, 1);
    assert.equal(created[0].ownerId, 'me');
    assert.equal(created[0].name, 'Landmine Press');
    assert.equal(created[0].note, null);
    assert.deepEqual(ids(next), ['cat', 'new-1']);
  });

  it('reuses the cloner exercise of that name, and a catalog one first', async () => {
    const { db, created } = fakeDb({
      exercises: [
        { id: 'cat', ownerId: null, name: 'Hack Squat' },
        custom('mine', 'me', 'landmine press'),
        custom('t1', 'them', 'Landmine Press'),
        custom('t2', 'them', 'Hack Squat'),
      ],
    });
    const next = await new CustomExercisesService(db).adoptForClone('me', setup(['t1', 't2']));
    assert.equal(created.length, 0);
    assert.deepEqual(ids(next), ['mine', 'cat']);
  });

  it('leaves a setup of catalog and own exercises untouched', async () => {
    const { db, created } = fakeDb({
      exercises: [{ id: 'cat', ownerId: null, name: 'Squat' }, custom('mine', 'me', 'Mine')],
    });
    const original = setup(['cat', 'mine']);
    assert.equal(await new CustomExercisesService(db).adoptForClone('me', original), original);
    assert.equal(created.length, 0);
  });

  it('refuses an exercise that no longer exists', async () => {
    const { db } = fakeDb({ exercises: [] });
    await assert.rejects(
      new CustomExercisesService(db).adoptForClone('me', setup(['gone'])),
      /UNKNOWN_EXERCISE/,
    );
  });
});
