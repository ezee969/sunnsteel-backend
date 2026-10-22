import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PgBoss } from 'pg-boss';
import { DatabaseService } from '../database/database.service';
import {
  DISPATCH_BATCH,
  DISPATCH_INTERVAL_MS,
  OUTBOX_RETENTION_DAYS,
  TOPIC_QUEUE_OPTIONS,
  assertTopic,
  deadLetterQueue,
  dispatchError,
  isDuplicateReceipt,
  type OutboxEnvelope,
  type TopicQueueOptions,
} from './outbox';

export type JobsStatus = 'disabled' | 'starting' | 'running' | 'stopped';

/** The work a consumer does, with the transaction its receipt is written in. */
export type OutboxHandler<P = unknown> = (
  tx: Prisma.TransactionClient,
  message: OutboxEnvelope<P>,
) => Promise<void>;

/** The pieces of pg-boss the service uses, so tests can stand in for it. */
export type JobQueue = Pick<
  PgBoss,
  'start' | 'stop' | 'send' | 'createQueue' | 'getQueue' | 'work' | 'on'
>;

/**
 * The process's pg-boss: its own `pgboss` schema, installed by `start()`, and a
 * small pool beside Prisma's. The replay tool passes `supervise: false` so a
 * one-off run does no maintenance.
 */
export function createBoss(
  options: Partial<ConstructorParameters<typeof PgBoss>[0] & object> = {},
): PgBoss {
  return new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: 'pgboss',
    application_name: 'sunnsteel-jobs',
    max: 3,
    ...options,
  });
}

interface Consumer {
  topic: string;
  handler: OutboxHandler;
}

/**
 * PLAT-01: durable jobs on the same PostgreSQL, through pg-boss (its own
 * `pgboss` schema, installed by `start()`; no Redis). Three parts:
 *
 * - **Dispatch.** Every `DISPATCH_INTERVAL_MS` a pass claims waiting outbox
 *   rows (`FOR UPDATE SKIP LOCKED`, so two instances never take one row),
 *   sends each to its topic's queue **with the row's id as the job id**, and
 *   stamps `dispatchedAt` in the same transaction. A crash between the send and
 *   the stamp leaves the row waiting; the next pass sends the same id again and
 *   pg-boss ignores it, because a job id is its primary key.
 * - **Consumption.** `consume(topic, handler)` runs the handler inside a
 *   transaction that first inserts the topic's `ProcessedMessage` receipt; a
 *   message delivered again finds the receipt and changes nothing, so a
 *   handler's database effect happens exactly once. A handler that throws
 *   rolls back with its receipt, and pg-boss retries it with backoff, then
 *   copies it to `<topic>.dead` (`TOPIC_QUEUE_OPTIONS`). A pg-boss queue
 *   hands each job to one worker, so a topic has exactly one consumer; work
 *   that two modules follow is two topics written in the same transaction.
 * - **Replay.** `npm run jobs:replay -- <topic>` redrives a topic's dead
 *   letters back to it (`prisma/jobs-replay.ts`).
 *
 * `DURABLE_JOBS_DISABLED=true` is the kill switch, as `REALTIME_DISABLED` is
 * for the stream: nothing starts, messages wait in the outbox, and they are
 * dispatched once it is lifted. `GET /health` reports the state and never
 * fails on it.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  readonly enabled = process.env.DURABLE_JOBS_DISABLED !== 'true';
  private boss: JobQueue | null = null;
  private timer: NodeJS.Timeout | null = null;
  private dispatching = false;
  private state: JobsStatus = this.enabled ? 'starting' : 'disabled';
  private readonly consumers: Consumer[] = [];
  private readonly queues = new Set<string>();
  private lastPrune = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly newBoss: () => JobQueue = () => createBoss(),
    /** Retries and expiry per topic; the integration test shortens them. */
    private readonly queueOptions: TopicQueueOptions = TOPIC_QUEUE_OPTIONS,
  ) {}

  get status(): JobsStatus {
    return this.state;
  }

  /**
   * Registers a topic's one consumer. Modules call it from `onModuleInit`,
   * before the application bootstraps and the workers start.
   */
  consume<P>(topic: string, handler: OutboxHandler<P>): void {
    assertTopic(topic);
    if (this.consumers.some((c) => c.topic === topic)) {
      throw new Error(`Topic ${topic} already has a consumer`);
    }
    const consumer = { topic, handler: handler as OutboxHandler };
    this.consumers.push(consumer);
    if (this.boss && this.state === 'running') void this.startConsumer(consumer);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Durable jobs disabled (DURABLE_JOBS_DISABLED=true)');
      return;
    }
    try {
      await this.start();
    } catch (error) {
      // A failed start leaves messages waiting in the outbox; it never takes
      // the API down.
      this.state = 'stopped';
      this.logger.error(`Durable jobs did not start: ${dispatchError(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    const boss = this.newBoss();
    boss.on('error', (error: unknown) =>
      this.logger.error(`pg-boss: ${dispatchError(error)}`),
    );
    try {
      await boss.start();
      this.boss = boss;
      for (const consumer of this.consumers) await this.startConsumer(consumer);
    } catch (error) {
      this.boss = null;
      this.queues.clear();
      await boss.stop({ graceful: false }).catch(() => undefined);
      throw error;
    }
    this.state = 'running';
    this.timer = setInterval(() => void this.dispatchOnce(), DISPATCH_INTERVAL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const boss = this.boss;
    this.boss = null;
    if (this.state !== 'disabled') this.state = 'stopped';
    if (boss) await boss.stop({ graceful: true, timeout: 10_000 });
  }

  /** Creates a topic's queue and its dead-letter queue once. */
  private async ensureQueue(topic: string): Promise<void> {
    if (this.queues.has(topic) || !this.boss) return;
    const dead = deadLetterQueue(topic);
    if (!(await this.boss.getQueue(dead))) await this.boss.createQueue(dead);
    if (!(await this.boss.getQueue(topic))) {
      await this.boss.createQueue(topic, { ...this.queueOptions, deadLetter: dead });
    }
    this.queues.add(topic);
  }

  private async startConsumer(consumer: Consumer): Promise<void> {
    if (!this.boss) return;
    await this.ensureQueue(consumer.topic);
    await this.boss.work<OutboxEnvelope>(consumer.topic, async (jobs) => {
      for (const job of jobs) await this.handle(consumer, job.data);
    });
  }

  /**
   * Runs one delivery: the receipt and the effect in one transaction. Answers
   * whether the effect ran (false for a message this consumer already took).
   */
  async handle(consumer: Consumer, message: OutboxEnvelope): Promise<boolean> {
    try {
      return await this.db.$transaction(async (tx) => {
        const inserted = await tx.processedMessage.createMany({
          data: [{ consumer: consumer.topic, messageId: message.messageId }],
          skipDuplicates: true,
        });
        if (inserted.count === 0) return false;
        await consumer.handler(tx, message);
        return true;
      });
    } catch (error) {
      // Two deliveries racing: the loser's receipt insert waits, then meets
      // the winner's committed row. That is a duplicate, not a failure.
      if (isDuplicateReceipt(error)) return false;
      throw error;
    }
  }

  /**
   * One dispatch pass; answers how many messages it handed to pg-boss. Runs
   * one pass at a time per instance, and `SKIP LOCKED` keeps instances apart.
   */
  async dispatchOnce(): Promise<number> {
    if (!this.boss || this.dispatching) return 0;
    this.dispatching = true;
    try {
      const sent = await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string; topic: string; payload: unknown; createdAt: Date }[]
        >`
          SELECT "id", "topic", "payload", "createdAt" FROM "OutboxMessage"
          WHERE "dispatchedAt" IS NULL
          ORDER BY "createdAt", "id"
          LIMIT ${DISPATCH_BATCH}
          FOR UPDATE SKIP LOCKED`;
        let count = 0;
        for (const row of rows) {
          try {
            await this.ensureQueue(row.topic);
            const envelope: OutboxEnvelope = {
              messageId: row.id,
              topic: row.topic,
              payload: row.payload,
              createdAt: row.createdAt.toISOString(),
            };
            // A null answer is an id pg-boss already holds: sent before a
            // crash, and just as dispatched.
            await this.boss!.send(row.topic, envelope as unknown as object, { id: row.id });
            await tx.outboxMessage.update({
              where: { id: row.id },
              data: { dispatchedAt: new Date(), lastError: null },
            });
            count += 1;
          } catch (error) {
            await tx.outboxMessage.update({
              where: { id: row.id },
              data: { attempts: { increment: 1 }, lastError: dispatchError(error) },
            });
          }
        }
        return count;
      }, { timeout: 30_000 });
      await this.pruneDispatched();
      return sent;
    } catch (error) {
      this.logger.error(`Outbox dispatch failed: ${dispatchError(error)}`);
      return 0;
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * At most hourly, drops dispatched rows and receipts past their retention.
   * A receipt only has to outlive its job's redeliveries, which end within
   * hours; a dead-lettered message never wrote one.
   */
  private async pruneDispatched(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPrune < 60 * 60 * 1000) return;
    this.lastPrune = now;
    const before = new Date(now - OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.db.outboxMessage.deleteMany({ where: { dispatchedAt: { lt: before } } });
    await this.db.processedMessage.deleteMany({ where: { processedAt: { lt: before } } });
  }
}
