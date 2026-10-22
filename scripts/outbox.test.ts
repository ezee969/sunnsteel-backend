import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import type { DatabaseService } from '../src/database/database.service';
import { JobsService, type JobQueue } from '../src/jobs/jobs.service';
import {
  assertTopic,
  deadLetterQueue,
  dispatchError,
  isDuplicateReceipt,
  writeOutbox,
  type OutboxEnvelope,
} from '../src/jobs/outbox';

function duplicate() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const envelope = (messageId: string): OutboxEnvelope => ({
  messageId,
  topic: 'billing.subscription',
  payload: { n: 1 },
  createdAt: '2026-10-22T12:00:00.000Z',
});

/** Receipts that roll back with a transaction that throws, as Postgres does. */
function receiptsDb() {
  const receipts = new Set<string>();
  const db = {
    receipts,
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const pending = new Set<string>();
      const tx = {
        processedMessage: {
          createMany: async ({ data }: { data: { consumer: string; messageId: string }[] }) => {
            const key = `${data[0].consumer}|${data[0].messageId}`;
            if (receipts.has(key) || pending.has(key)) return { count: 0 };
            pending.add(key);
            return { count: 1 };
          },
        },
      };
      const result = await work(tx);
      for (const key of pending) receipts.add(key);
      return result;
    },
  };
  return db;
}

interface Row {
  id: string;
  topic: string;
  payload: unknown;
  createdAt: Date;
  dispatchedAt: Date | null;
  attempts: number;
  lastError: string | null;
}

function outboxDb(rows: Row[]) {
  const deleted: string[] = [];
  const db = {
    rows,
    deleted,
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        $queryRaw: async () =>
          rows
            .filter((row) => row.dispatchedAt === null)
            .map(({ id, topic, payload, createdAt }) => ({ id, topic, payload, createdAt })),
        outboxMessage: {
          update: async ({
            where,
            data,
          }: {
            where: { id: string };
            data: { dispatchedAt?: Date; lastError?: string | null; attempts?: { increment: number } };
          }) => {
            const row = rows.find((r) => r.id === where.id)!;
            if (data.dispatchedAt) row.dispatchedAt = data.dispatchedAt;
            if (data.attempts) row.attempts += data.attempts.increment;
            if (data.lastError !== undefined) row.lastError = data.lastError;
            return row;
          },
        },
      };
      return work(tx);
    },
    outboxMessage: { deleteMany: async () => (deleted.push('outbox'), { count: 0 }) },
    processedMessage: { deleteMany: async () => (deleted.push('receipts'), { count: 0 }) },
  };
  return db;
}

function fakeBoss(failFor = new Set<string>()) {
  const sent: { name: string; data: unknown; id?: string }[] = [];
  const queues = new Map<string, unknown>();
  const workers: string[] = [];
  const boss = {
    sent,
    queues,
    workers,
    started: false,
    on: () => boss,
    start: async () => ((boss.started = true), boss),
    stop: async () => undefined,
    getQueue: async (name: string) => (queues.has(name) ? { name } : null),
    createQueue: async (name: string, options?: unknown) => void queues.set(name, options ?? {}),
    send: async (name: string, data: unknown, options?: { id?: string }) => {
      if (failFor.has(options?.id ?? '')) throw new Error('connection refused');
      sent.push({ name, data, id: options?.id });
      return options?.id ?? null;
    },
    work: async (name: string) => (workers.push(name), 'worker'),
  };
  return boss;
}

const service = (db: object, boss: object = fakeBoss()) =>
  new JobsService(db as unknown as DatabaseService, () => boss as unknown as JobQueue);

describe('outbox writes (PLAT-01)', () => {
  it('takes pg-boss queue names as topics and refuses anything else', () => {
    for (const topic of ['billing.subscription', 'a', 'b-2_c.d']) assertTopic(topic);
    for (const topic of ['', 'Billing', '1topic', 'a b', 'a/b', 'x'.repeat(81)]) {
      assert.throws(() => assertTopic(topic), /Invalid outbox topic/);
    }
  });

  it('names the dead-letter queue after its topic and cuts an error to the column', () => {
    assert.equal(deadLetterQueue('billing.subscription'), 'billing.subscription.dead');
    assert.equal(dispatchError(new Error('x'.repeat(600))).length, 500);
    assert.equal(dispatchError('plain'), 'plain');
  });

  it('writes with the client it is given, deduplicated by key', async () => {
    const calls: unknown[] = [];
    const tx = { outboxMessage: { createMany: async (args: unknown) => (calls.push(args), { count: 1 }) } };
    await writeOutbox(tx as never, { topic: 'billing.subscription', payload: { a: 1 } });
    await writeOutbox(tx as never, { topic: 'billing.subscription', payload: {}, dedupeKey: 'evt_1' });
    assert.deepEqual(calls, [
      { data: [{ topic: 'billing.subscription', payload: { a: 1 }, dedupeKey: null }], skipDuplicates: true },
      { data: [{ topic: 'billing.subscription', payload: {}, dedupeKey: 'evt_1' }], skipDuplicates: true },
    ]);
  });

  it('writes nothing for a bad topic', async () => {
    let wrote = false;
    const tx = { outboxMessage: { createMany: async () => ((wrote = true), { count: 1 }) } };
    await assert.rejects(writeOutbox(tx as never, { topic: 'Bad Topic', payload: {} }));
    assert.equal(wrote, false);
  });

  it('reads only a unique violation as a duplicate receipt', () => {
    assert.equal(isDuplicateReceipt(duplicate()), true);
    assert.equal(isDuplicateReceipt(new Error('P2002')), false);
  });
});

describe('consumption (PLAT-01)', () => {
  it('runs an effect once however often a message is delivered', async () => {
    const db = receiptsDb();
    const jobs = service(db);
    let effects = 0;
    const consumer = { topic: 'billing.subscription', handler: async () => void (effects += 1) };
    assert.equal(await jobs.handle(consumer, envelope('m1')), true);
    assert.equal(await jobs.handle(consumer, envelope('m1')), false);
    assert.equal(await jobs.handle(consumer, envelope('m2')), true);
    assert.equal(effects, 2);
  });

  it('rolls the receipt back with a failing handler, so the retry runs it', async () => {
    const db = receiptsDb();
    const jobs = service(db);
    let attempts = 0;
    const consumer = {
      topic: 'billing.subscription',
      handler: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('provider down');
      },
    };
    await assert.rejects(jobs.handle(consumer, envelope('m1')), /provider down/);
    assert.equal(db.receipts.size, 0);
    assert.equal(await jobs.handle(consumer, envelope('m1')), true);
    assert.equal(attempts, 2);
  });

  it('reads a racing delivery that meets the receipt as a duplicate', async () => {
    const db = { $transaction: async () => Promise.reject(duplicate()) };
    const consumer = { topic: 'billing.subscription', handler: async () => undefined };
    assert.equal(await service(db).handle(consumer, envelope('m1')), false);
  });

  it('keeps one consumer per topic, because a queue hands each job to one worker', () => {
    const jobs = service({});
    jobs.consume('billing.subscription', async () => undefined);
    assert.throws(() => jobs.consume('billing.subscription', async () => undefined), /already has a consumer/);
    assert.throws(() => jobs.consume('Bad', async () => undefined), /Invalid outbox topic/);
  });

  it('starts each consumer with its queue and dead-letter queue', async () => {
    const boss = fakeBoss();
    const jobs = service({}, boss);
    jobs.consume('billing.subscription', async () => undefined);
    await jobs.start();
    await jobs.stop();
    assert.deepEqual(boss.workers, ['billing.subscription']);
    assert.deepEqual(boss.queues.get('billing.subscription'), {
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 600,
      expireInSeconds: 300,
      deadLetter: 'billing.subscription.dead',
    });
    assert.ok(boss.queues.has('billing.subscription.dead'));
  });
});

describe('dispatch (PLAT-01)', () => {
  const row = (id: string, topic = 'billing.subscription'): Row => ({
    id,
    topic,
    payload: { id },
    createdAt: new Date('2026-10-22T12:00:00.000Z'),
    dispatchedAt: null,
    attempts: 0,
    lastError: null,
  });

  it('sends nothing before it starts', async () => {
    const db = outboxDb([row('a')]);
    assert.equal(await service(db).dispatchOnce(), 0);
    assert.equal(db.rows[0].dispatchedAt, null);
  });

  it('sends each waiting message with its own id as the job id and stamps it', async () => {
    const db = outboxDb([row('a'), row('b', 'other.topic')]);
    const boss = fakeBoss();
    const jobs = service(db, boss);
    await jobs.start();
    assert.equal(await jobs.dispatchOnce(), 2);
    await jobs.stop();
    assert.deepEqual(
      boss.sent.map(({ name, id }) => [name, id]),
      [
        ['billing.subscription', 'a'],
        ['other.topic', 'b'],
      ],
    );
    assert.deepEqual(boss.sent[0].data, {
      messageId: 'a',
      topic: 'billing.subscription',
      payload: { id: 'a' },
      createdAt: '2026-10-22T12:00:00.000Z',
    });
    assert.ok(db.rows.every((r) => r.dispatchedAt instanceof Date));
    assert.ok(boss.queues.has('other.topic.dead'));
    assert.deepEqual(db.deleted, ['outbox', 'receipts']);
  });

  it('leaves a message it could not send waiting, with the attempt recorded', async () => {
    const db = outboxDb([row('a'), row('b')]);
    const boss = fakeBoss(new Set(['a']));
    const jobs = service(db, boss);
    await jobs.start();
    assert.equal(await jobs.dispatchOnce(), 1);
    assert.equal(db.rows[0].dispatchedAt, null);
    assert.equal(db.rows[0].attempts, 1);
    assert.equal(db.rows[0].lastError, 'connection refused');
    assert.ok(db.rows[1].dispatchedAt);
    boss.send = async (name, data, options) => (boss.sent.push({ name, data, id: options?.id }), null);
    assert.equal(await jobs.dispatchOnce(), 1, 'a resend pg-boss already holds is still dispatched');
    assert.ok(db.rows[0].dispatchedAt);
    assert.equal(db.rows[0].lastError, null);
    await jobs.stop();
  });
});

describe('the kill switch and a failed start (PLAT-01)', () => {
  it('starts nothing under DURABLE_JOBS_DISABLED', async () => {
    process.env.DURABLE_JOBS_DISABLED = 'true';
    try {
      let built = false;
      const jobs = new JobsService({} as DatabaseService, () => {
        built = true;
        return fakeBoss() as unknown as JobQueue;
      });
      await jobs.onApplicationBootstrap();
      assert.equal(jobs.status, 'disabled');
      assert.equal(built, false);
      await jobs.onModuleDestroy();
      assert.equal(jobs.status, 'disabled');
    } finally {
      delete process.env.DURABLE_JOBS_DISABLED;
    }
  });

  it('keeps the API up when pg-boss cannot start', async () => {
    const boss = fakeBoss();
    boss.start = async () => Promise.reject(new Error('no database'));
    const jobs = service({}, boss);
    assert.equal(jobs.status, 'starting');
    await jobs.onApplicationBootstrap();
    assert.equal(jobs.status, 'stopped');
  });
});
