import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Prisma } from '@prisma/client';
import type { PgBoss } from 'pg-boss';
import { DatabaseService } from '../src/database/database.service';
import { createBoss, JobsService } from '../src/jobs/jobs.service';
import { deadLetterQueue, writeOutbox, type OutboxEnvelope } from '../src/jobs/outbox';

const enabled = process.env.ANALYTICS_TEST_DATABASE === 'isolated';

async function until(what: string, check: () => Promise<boolean>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(250);
  }
  assert.fail(`Timed out waiting for ${what}`);
}

/**
 * PLAT-01 on real PostgreSQL and a real pg-boss: a message exists exactly
 * when its transaction committed, waits while the worker is stopped, is sent
 * once under its own id, takes effect once however often it is delivered, and
 * a message whose handler keeps failing retries, lands in the dead-letter
 * queue and comes back with a redrive.
 */
test(
  'the outbox and durable jobs on real PostgreSQL',
  { skip: !enabled },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/td27_test');
    const db = new DatabaseService();
    const topics = ['plat01.once', 'plat01.fails', 'plat01.effect'];
    const cleanUp = async () => {
      await db.outboxMessage.deleteMany({ where: { topic: { in: topics } } });
      await db.processedMessage.deleteMany({ where: { consumer: { in: topics } } });
    };
    const effects = () => db.processedMessage.count({ where: { consumer: 'plat01.effect' } });
    await cleanUp();
    let boss: PgBoss | null = null;
    const jobs = new JobsService(
      db,
      () => (boss = createBoss({ supervise: false })),
      { retryLimit: 1, retryDelay: 1, retryBackoff: false, expireInSeconds: 30 },
    );
    try {
      // The effect a consumer has is written in the receipt's transaction: a
      // row of its own, which is easy to count.
      const effect = async (tx: Prisma.TransactionClient, message: OutboxEnvelope) => {
        await tx.processedMessage.create({
          data: { consumer: 'plat01.effect', messageId: `${message.messageId}:${Date.now()}` },
        });
      };
      jobs.consume('plat01.once', effect);
      let failing = true;
      jobs.consume('plat01.fails', async (tx, message) => {
        if (failing) throw new Error('provider down');
        await effect(tx, message);
      });

      // A rolled-back change announces nothing.
      await assert.rejects(
        db.$transaction(async (tx) => {
          await writeOutbox(tx, { topic: 'plat01.once', payload: { n: 0 } });
          throw new Error('rolled back');
        }),
      );
      assert.equal(await db.outboxMessage.count({ where: { topic: 'plat01.once' } }), 0);

      // A committed one waits while the worker is stopped.
      await db.$transaction((tx) =>
        writeOutbox(tx, { topic: 'plat01.once', payload: { n: 1 }, dedupeKey: 'plat01:1' }),
      );
      await db.$transaction((tx) =>
        writeOutbox(tx, { topic: 'plat01.once', payload: { n: 1 }, dedupeKey: 'plat01:1' }),
      );
      assert.equal(await jobs.dispatchOnce(), 0);
      const waiting = await db.outboxMessage.findMany({ where: { topic: 'plat01.once' } });
      assert.equal(waiting.length, 1, 'the same key writes one message');
      assert.equal(waiting[0].dispatchedAt, null);

      // Started, it is sent once, under its own id.
      await jobs.start();
      assert.equal(jobs.status, 'running');
      assert.equal(await jobs.dispatchOnce(), 1);
      const [sent] = await db.outboxMessage.findMany({ where: { topic: 'plat01.once' } });
      assert.ok(sent.dispatchedAt);
      const live = boss! as PgBoss;
      assert.equal(
        await live.send('plat01.once', { messageId: sent.id }, { id: sent.id }),
        null,
        'a resend under the same id is ignored',
      );

      // It takes effect once, and delivering it again changes nothing.
      await until('the consumer to take the message', async () => (await effects()) === 1);
      const message: OutboxEnvelope = {
        messageId: sent.id,
        topic: 'plat01.once',
        payload: sent.payload,
        createdAt: sent.createdAt.toISOString(),
      };
      assert.equal(await jobs.handle({ topic: 'plat01.once', handler: effect }, message), false);
      assert.equal(await effects(), 1);

      // A handler that keeps failing retries, then lands in the dead letters.
      // From here the dispatcher's own timer sends it.
      await db.$transaction((tx) => writeOutbox(tx, { topic: 'plat01.fails', payload: { n: 2 } }));
      await until('the dispatcher to send it', async () =>
        (await db.outboxMessage.count({ where: { topic: 'plat01.fails', dispatchedAt: null } })) === 0,
      );
      const dead = deadLetterQueue('plat01.fails');
      // Queue counts are refreshed by pg-boss's supervisor, so read the jobs.
      const deadLetters = async () => (await live.findJobs(dead, { queued: true })).length;
      await until('the message to be dead-lettered', async () => (await deadLetters()) === 1);
      assert.equal(await effects(), 1, 'a failed attempt left no effect');
      assert.equal(
        await db.processedMessage.count({ where: { consumer: 'plat01.fails' } }),
        0,
        'nor a receipt',
      );

      // Fixed and redriven, it takes effect once.
      failing = false;
      assert.equal((await live.previewRedrive(dead, { destination: 'plat01.fails' })).total, 1);
      assert.equal(await live.redrive(dead, { destination: 'plat01.fails' }), 1);
      await until('the redriven message to take effect', async () => (await effects()) === 2);
      assert.equal(await deadLetters(), 0);
    } finally {
      await jobs.stop();
      assert.equal(jobs.status, 'stopped');
      await cleanUp();
      await db.$disconnect();
    }
  },
);
