import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * BILL-03/BILL-04 tests: the tables checkout and the subscription lifecycle
 * touch, in memory, with the partial unique index that holds one waiting
 * attempt per member, the (provider, externalId) and (provider, event) unique
 * keys, and a transaction that rolls back when it throws.
 */
export interface Row {
  [key: string]: unknown;
}

export const NOW = new Date('2026-11-01T12:00:00.000Z');

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Row[]).some((branch) => matches(row, branch));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const filter = value as { in?: unknown[]; lte?: Date; gt?: Date; not?: unknown };
      if (filter.in) return filter.in.includes(row[key]);
      if (filter.lte) return (row[key] as Date) <= filter.lte;
      if (filter.gt) return (row[key] as Date) > filter.gt;
      if ('not' in filter) return row[key] !== filter.not;
    }
    return row[key] === value;
  });
}

const unique = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

function table(rows: Row[], defaults: () => Row, conflict: (data: Row) => boolean = () => false) {
  return {
    findFirst: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: { where: Row }) => {
      const key = (where.provider_externalId ?? where.id ? where : where) as Row;
      const flat = (key.provider_externalId as Row | undefined) ?? key;
      return rows.find((r) => matches(r, flat)) ?? null;
    },
    findUniqueOrThrow: async ({ where }: { where: Row }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      return row;
    },
    findMany: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where ?? {})),
    count: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: { data: Row }) => {
      if (conflict(data)) throw unique();
      const row = { ...defaults(), ...data };
      rows.push(row);
      return row;
    },
    createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const item of data) {
        if (conflict(item)) {
          if (skipDuplicates) continue;
          throw unique();
        }
        rows.push({ ...defaults(), ...item });
        count += 1;
      }
      return { count };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      return Object.assign(row, data);
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const found = rows.filter((r) => matches(r, where));
      found.forEach((row) => Object.assign(row, data));
      return { count: found.length };
    },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const flat = (where.provider_externalId as Row | undefined) ?? where;
      const found = rows.find((r) => matches(r, flat));
      if (found) return Object.assign(found, update);
      const row = { ...defaults(), ...create };
      rows.push(row);
      return row;
    },
  };
}

export function memoryDb(grants: Row[] = []) {
  const state = {
    attempts: [] as Row[],
    subscriptions: [] as Row[],
    grants,
    notifications: [] as Row[],
    providerNotifications: [] as Row[],
    outbox: [] as Row[],
  };
  const client = {
    checkoutAttempt: table(
      state.attempts,
      () => ({
        id: randomUUID(),
        status: 'PENDING',
        externalId: null,
        checkoutUrl: null,
        failureCode: null,
        subscriptionId: null,
        completedAt: null,
        trialDays: null,
        createdAt: NOW,
      }),
      (data) => state.attempts.some((r) => r.userId === data.userId && r.status === 'PENDING'),
    ),
    subscription: table(
      state.subscriptions,
      () => ({
        id: randomUUID(),
        createdAt: NOW,
        trialEndsAt: null,
        pastDueSince: null,
        cancelAtPeriodEnd: false,
        lastSyncedAt: null,
        currentPeriodEnd: null,
      }),
      (data) => state.subscriptions.some((r) => r.provider === data.provider && r.externalId === data.externalId),
    ),
    entitlementGrant: table(state.grants, () => ({ id: randomUUID(), revokedAt: null, startsAt: NOW, expiresAt: null })),
    notification: table(
      state.notifications,
      () => ({ id: randomUUID(), readAt: null }),
      (data) => state.notifications.some((r) => r.userId === data.userId && r.sourceKey === data.sourceKey),
    ),
    providerNotification: table(
      state.providerNotifications,
      () => ({ id: randomUUID(), processedAt: null, outcome: null }),
      (data) =>
        state.providerNotifications.some(
          (r) => r.provider === data.provider && r.externalEventId === data.externalEventId,
        ),
    ),
    outboxMessage: table(
      state.outbox,
      () => ({ id: randomUUID(), dispatchedAt: null }),
      (data) => data.dedupeKey != null && state.outbox.some((r) => r.dedupeKey === data.dedupeKey),
    ),
    // `SELECT ... FOR UPDATE` by id (an attempt) or by provider and external id (a subscription).
    $queryRaw: async (sql: TemplateStringsArray, ...params: unknown[]) => {
      const text = sql.join('?');
      if (text.includes('"CheckoutAttempt"')) {
        return state.attempts.filter((r) => r.id === params[0]).map(({ status }) => ({ status }));
      }
      return state.subscriptions
        .filter((r) => r.provider === params[0] && r.externalId === params[1])
        .map(({ id }) => ({ id }));
    },
  };
  const snapshot = () => structuredClone(state);
  const restore = (saved: typeof state) => {
    for (const key of Object.keys(state) as (keyof typeof state)[]) {
      state[key].splice(0, state[key].length, ...saved[key]);
    }
  };
  return {
    ...client,
    state,
    $transaction: async <T>(work: (tx: typeof client) => Promise<T>): Promise<T> => {
      const saved = snapshot();
      try {
        return await work(client);
      } catch (error) {
        restore(saved);
        throw error;
      }
    },
  };
}

export type MemoryDb = ReturnType<typeof memoryDb>;
