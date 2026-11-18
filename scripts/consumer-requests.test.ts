import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { consumerRequestProblems, normalizeConsumerRequest } from '@sunsteel/contracts';
import { CONSUMER_REQUEST_CODE, consumerRequestCode } from '../src/consumer-requests/consumer-request-code';
import { ConsumerRequestsService } from '../src/consumer-requests/consumer-requests.service';
import type { DatabaseService } from '../src/database/database.service';
import { toAppNotification } from '../src/notifications/notifications.service';

const NOW = new Date('2026-11-18T21:00:00Z');

type Row = Record<string, any>;

/** Just what the service touches, in memory. */
function memory(moderators: string[] = ['mod-1', 'mod-2']) {
  const requests: Row[] = [];
  const notifications: Row[] = [];
  let collisions = 0;
  const db = {
    consumerRequest: {
      create: async ({ data }: { data: Row }) => {
        if (collisions > 0) {
          collisions -= 1;
          throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
        }
        const row = { id: `req-${requests.length + 1}`, status: 'OPEN', handledAt: null, ...data };
        requests.push(row);
        return row;
      },
      findMany: async () =>
        [...requests].sort((a, b) =>
          a.status === b.status ? b.createdAt.getTime() - a.createdAt.getTime() : a.status === 'OPEN' ? -1 : 1,
        ),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = requests.find((r) => r.id === where.id && r.status === where.status);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
      findUnique: async ({ where }: { where: Row }) => requests.find((r) => r.id === where.id) ?? null,
    },
    user: { findMany: async () => moderators.map((id) => ({ id })) },
    notification: {
      createMany: async ({ data }: { data: Row[] }) => {
        notifications.push(...data);
        return { count: data.length };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return {
    requests,
    notifications,
    collideNext: (n: number) => (collisions = n),
    service: new ConsumerRequestsService(db as unknown as DatabaseService),
  };
}

const valid = {
  kind: 'REVOCATION' as const,
  name: '  Ana Pérez ',
  email: ' Ana@Example.com ',
  reference: ' 189276558029 ',
  details: '',
};

describe('the request code (BILL-07)', () => {
  it('names the kind and reads aloud without 0/O or 1/I/L', () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(consumerRequestCode('REVOCATION'), CONSUMER_REQUEST_CODE);
      assert.match(consumerRequestCode('CANCELLATION'), /^BAJ-/);
    }
    assert.equal(consumerRequestCode('REVOCATION', () => Buffer.alloc(8, 0)), 'ARR-AAAA-AAAA');
  });
});

describe('the shared rules (BILL-07)', () => {
  it('trims, lowercases the email and leaves empty optional fields out', () => {
    assert.deepEqual(normalizeConsumerRequest(valid), {
      kind: 'REVOCATION',
      name: 'Ana Pérez',
      email: 'ana@example.com',
      reference: '189276558029',
    });
  });

  it('names each field it refuses', () => {
    assert.deepEqual(consumerRequestProblems(normalizeConsumerRequest(valid)), []);
    assert.deepEqual(
      consumerRequestProblems(
        normalizeConsumerRequest({ kind: 'OTHER' as never, name: ' ', email: 'not-an-email', details: 'x'.repeat(501) }),
      ),
      ['kind', 'name', 'email', 'details'],
    );
  });
});

describe('a request (BILL-07)', () => {
  it('is stored with its code and told to every moderator in the same write', async () => {
    const { service, requests, notifications } = memory();
    const receipt = await service.create(valid, NOW);
    assert.match(receipt.code, /^ARR-/);
    assert.equal(receipt.createdAt, NOW.toISOString());
    assert.equal(requests[0].email, 'ana@example.com');
    assert.equal(requests[0].details, null);
    assert.deepEqual(
      notifications.map((n) => [n.userId, n.kind, n.sourceKey, n.payload.code]),
      [
        ['mod-1', 'CONSUMER_REQUEST', `consumer-request:${requests[0].id}`, receipt.code],
        ['mod-2', 'CONSUMER_REQUEST', `consumer-request:${requests[0].id}`, receipt.code],
      ],
    );
  });

  it('is refused with a code when the shared rules refuse it, and nothing is stored', async () => {
    const { service, requests } = memory();
    await assert.rejects(service.create({ ...valid, email: 'nope' }, NOW), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 400);
      assert.equal((error.getResponse() as { code?: string }).code, 'CONSUMER_REQUEST_INVALID');
      return true;
    });
    assert.equal(requests.length, 0);
  });

  it('draws another code when one collides', async () => {
    const { service, requests, collideNext } = memory();
    collideNext(2);
    await service.create(valid, NOW);
    assert.equal(requests.length, 1);
  });

  it('is still stored when there is no moderator to tell', async () => {
    const { service, requests, notifications } = memory([]);
    await service.create({ ...valid, kind: 'CANCELLATION' }, NOW);
    assert.equal(requests.length, 1);
    assert.equal(notifications.length, 0);
  });
});

describe('settling requests (BILL-07)', () => {
  it('lists open ones first, newest first, and marks one done once', async () => {
    const { service } = memory();
    await service.create(valid, new Date('2026-11-01T00:00:00Z'));
    await service.create(valid, new Date('2026-11-05T00:00:00Z'));
    const [newest, oldest] = await service.list();
    assert.equal(newest.createdAt, '2026-11-05T00:00:00.000Z');
    const done = await service.markDone(oldest.id, NOW);
    assert.equal(done.status, 'DONE');
    assert.equal(done.handledAt, NOW.toISOString());
    const again = await service.markDone(oldest.id, new Date('2026-12-01T00:00:00Z'));
    assert.equal(again.handledAt, NOW.toISOString(), 'a second mark changes nothing');
    assert.deepEqual(
      (await service.list()).map((r) => r.status),
      ['OPEN', 'DONE'],
    );
  });

  it('answers 404 for a request that does not exist', async () => {
    const { service } = memory();
    await assert.rejects(service.markDone('missing', NOW), (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 404);
      return true;
    });
  });
});

describe("the moderators' notice (BILL-07)", () => {
  const row = (payload: unknown) =>
    ({
      id: 'n1',
      kind: 'CONSUMER_REQUEST',
      payload,
      createdAt: NOW,
      readAt: null,
    }) as unknown as Parameters<typeof toAppNotification>[0];

  it('names the request by kind and code', () => {
    assert.deepEqual(toAppNotification(row({ requestKind: 'CANCELLATION', code: 'BAJ-AAAA-BBBB' }), new Set()), {
      id: 'n1',
      createdAt: NOW.toISOString(),
      readAt: null,
      kind: 'CONSUMER_REQUEST',
      request: { kind: 'CANCELLATION', code: 'BAJ-AAAA-BBBB' },
    });
  });

  it('drops a notice it cannot read', () => {
    assert.equal(toAppNotification(row({ requestKind: 'OTHER', code: 'X' }), new Set()), null);
    assert.equal(toAppNotification(row({ requestKind: 'REVOCATION' }), new Set()), null);
  });
});
