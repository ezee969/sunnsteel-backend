import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { STARRED_EXERCISES_MAX } from '@sunsteel/contracts';
import { DatabaseService } from '../src/database/database.service';
import { ExerciseStarsService } from '../src/exercises/exercise-stars.service';

type Row = { userId: string; exerciseId: string; createdAt: Date };

function fakeDb(rows: Row[], exercises = new Set(['bench', 'squat'])) {
  const calls: string[] = [];
  const starredExercise = {
    findMany: async (query: any) => {
      calls.push('findMany');
      assert.deepEqual(query.orderBy, [
        { createdAt: 'desc' },
        { exerciseId: 'asc' },
      ]);
      assert.equal(query.take, STARRED_EXERCISES_MAX);
      return rows
        .filter((row) => row.userId === query.where.userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    findUnique: async (query: any) => {
      const { userId, exerciseId } = query.where.userId_exerciseId;
      return (
        rows.find(
          (row) => row.userId === userId && row.exerciseId === exerciseId,
        ) ?? null
      );
    },
    count: async (query: any) =>
      rows.filter((row) => row.userId === query.where.userId).length,
    create: async (query: any) => {
      calls.push('create');
      rows.push({ ...query.data, createdAt: new Date(Date.now() + rows.length) });
    },
    deleteMany: async (query: any) => {
      calls.push('deleteMany');
      const before = rows.length;
      const kept = rows.filter(
        (row) =>
          !(
            row.userId === query.where.userId &&
            row.exerciseId === query.where.exerciseId
          ),
      );
      rows.splice(0, rows.length, ...kept);
      return { count: before - kept.length };
    },
  };
  const tx = {
    exercise: {
      findUnique: async (query: any) =>
        exercises.has(query.where.id) ? { id: query.where.id } : null,
    },
    starredExercise,
  };
  const db = {
    ...tx,
    $transaction: async (run: any) => run(tx),
  } as unknown as DatabaseService;
  return { db, calls, rows };
}

test('starring is idempotent and returns the list newest first', async () => {
  const { db, calls } = fakeDb([
    { userId: 'u1', exerciseId: 'squat', createdAt: new Date('2026-09-01') },
    { userId: 'u2', exerciseId: 'bench', createdAt: new Date('2026-09-02') },
  ]);
  const service = new ExerciseStarsService(db);

  const first = await service.star('u1', 'bench');
  assert.deepEqual(
    first.items.map((item) => item.exerciseId),
    ['bench', 'squat'],
  );
  assert.equal(typeof first.items[0].starredAt, 'string');

  const again = await service.star('u1', 'bench');
  assert.deepEqual(again, first);
  assert.equal(calls.filter((call) => call === 'create').length, 1);
});

test('starring refuses unknown exercises and a full list', async () => {
  const service = new ExerciseStarsService(fakeDb([]).db);
  await assert.rejects(service.star('u1', 'missing'), NotFoundException);

  const full = Array.from({ length: STARRED_EXERCISES_MAX }, (_, index) => ({
    userId: 'u1',
    exerciseId: `exercise-${index}`,
    createdAt: new Date(2026, 0, 1, 0, index),
  }));
  const capped = new ExerciseStarsService(fakeDb(full).db);
  await assert.rejects(capped.star('u1', 'bench'), ConflictException);
  // Re-starring something already starred is still fine at the cap.
  full[0].exerciseId = 'bench';
  await assert.doesNotReject(capped.star('u1', 'bench'));
});

test('a concurrent duplicate star is treated as success', async () => {
  const { db } = fakeDb([]);
  (db as any).starredExercise.create = async () => {
    throw new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
  };
  const result = await new ExerciseStarsService(db).star('u1', 'bench');
  assert.deepEqual(result, { items: [] });
});

test('unstarring removes only the owner star and is idempotent', async () => {
  const rows = [
    { userId: 'u1', exerciseId: 'bench', createdAt: new Date('2026-09-01') },
    { userId: 'u2', exerciseId: 'bench', createdAt: new Date('2026-09-02') },
  ];
  const service = new ExerciseStarsService(fakeDb(rows).db);
  assert.deepEqual(await service.unstar('u1', 'bench'), { items: [] });
  assert.deepEqual(await service.unstar('u1', 'bench'), { items: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, 'u2');
});
