import { Prisma } from '@prisma/client';

/**
 * PLAT-01: the transactional outbox. A change that other work must follow --
 * billing's subscription events first (`BILL-04`) -- writes an
 * `OutboxMessage` with the same transaction client as the change itself, so
 * the message exists exactly when the change committed: a rollback announces
 * nothing, and a crash after the commit loses nothing.
 *
 * What it is not: it does not replace `@nestjs/schedule` timers or the push
 * sweep's `DELETE ... RETURNING` claim, and it is not a second realtime
 * transport beside `MSG-06`'s `pg_notify`.
 */

/** A message as a consumer receives it. */
export interface OutboxEnvelope<P = unknown> {
  /** The outbox row's id, which is also the pg-boss job id. */
  messageId: string;
  topic: string;
  payload: P;
  /** When the change was committed, as an ISO string. */
  createdAt: string;
}

export interface OutboxWrite {
  topic: string;
  payload: Prisma.InputJsonValue;
  /**
   * Announcing the same fact twice -- a retried request, a provider
   * notification delivered again -- writes one message when a key is given.
   */
  dedupeKey?: string;
}

type OutboxDb = Pick<Prisma.TransactionClient, 'outboxMessage'>;

/** Topic names are pg-boss queue names: letters, digits, `.`, `-`, `_`. */
const TOPIC = /^[a-z][a-z0-9._-]{0,79}$/;

export function assertTopic(topic: string): void {
  if (!TOPIC.test(topic)) throw new Error(`Invalid outbox topic: ${topic}`);
}

/**
 * Writes a message with the caller's transaction client. Pass the `tx` of the
 * change it announces -- never the root client -- or the message and the
 * change can disagree.
 */
export async function writeOutbox(tx: OutboxDb, message: OutboxWrite): Promise<void> {
  assertTopic(message.topic);
  await tx.outboxMessage.createMany({
    data: [
      {
        topic: message.topic,
        payload: message.payload,
        dedupeKey: message.dedupeKey ?? null,
      },
    ],
    skipDuplicates: true,
  });
}

/** The dead-letter queue a topic's failed messages are copied into. */
export function deadLetterQueue(topic: string): string {
  return `${topic}.dead`;
}

/**
 * Every topic's queue: a handful of retries with exponential backoff (5 s, then
 * about 10, 20, 40...), capped at ten minutes, then the dead-letter queue,
 * where the replay tool (`npm run jobs:replay`) can send them back.
 */
export interface TopicQueueOptions {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  /** pg-boss accepts a cap only with backoff. */
  retryDelayMax?: number;
  /** A handler that runs longer than this is retried. */
  expireInSeconds: number;
}

export const TOPIC_QUEUE_OPTIONS: TopicQueueOptions = {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 600,
  expireInSeconds: 300,
};

/** How many waiting messages one dispatch pass takes. */
export const DISPATCH_BATCH = 50;

/** How often the dispatcher looks for waiting messages, in milliseconds. */
export const DISPATCH_INTERVAL_MS = 2000;

/** Dispatched messages are kept this long, for tracing, then deleted. */
export const OUTBOX_RETENTION_DAYS = 7;

/** A failed dispatch's error, cut to the column. */
export function dispatchError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500);
}

/** Whether an error is the receipt's primary key refusing a second insert. */
export function isDuplicateReceipt(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}
