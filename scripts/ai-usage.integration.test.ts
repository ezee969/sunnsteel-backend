import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { AiUsageService } from '../src/ai/ai-usage';
import { DatabaseService } from '../src/database/database.service';

const enabled = process.env.ANALYTICS_TEST_DATABASE === 'isolated';

/**
 * INTEL-03 on real PostgreSQL: racing requests are decided one at a time, so
 * neither a member's quota nor the month's ceiling can be overrun, and a
 * member's spend outlives their account.
 */
test(
  'the model usage ledger on real PostgreSQL',
  { skip: !enabled && 'needs the isolated analytics test database' },
  async () => {
    const db = new DatabaseService();
    await db.$connect();
    const usage = new AiUsageService(db, {
      get: () => '1',
    } as unknown as ConfigService);
    const now = new Date('2031-03-15T12:00:00.000Z');
    const makeUser = () =>
      db.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          username: `ledger_${randomUUID().slice(0, 8)}`,
          name: 'Ledger test',
        },
        select: { id: true },
      });
    const reserve = (userId: string, limit: number, reserveMicros = 1000) =>
      usage.reserve({ userId, feature: 'TEST', model: 'm', reserveMicros, limit, now });

    try {
      const member = await makeUser();
      const race = await Promise.all(
        Array.from({ length: 8 }, () => reserve(member.id, 2)),
      );
      assert.equal(race.filter((result) => result.id !== null).length, 2);
      assert.equal(race.filter((result) => result.refusal === 'QUOTA_REACHED').length, 6);

      const first = race.find((result) => result.id !== null)!;
      await usage.settle(first.id!, {
        status: 'FAILED',
        model: 'm',
        usage: { inputTokens: 1, outputTokens: 1 },
        costMicros: 10,
      });
      assert.equal(
        (await usage.read({ userId: member.id, feature: 'TEST', reserveMicros: 0, limit: 2, now })).used,
        1,
      );

      const crashed = await db.aiUsageRecord.create({
        data: {
          userId: member.id,
          feature: 'STALE',
          model: 'm',
          costMicros: 1000,
          createdAt: new Date(now.getTime() - 11 * 60_000),
        },
      });
      assert.equal(
        (await usage.read({ userId: member.id, feature: 'STALE', reserveMicros: 0, limit: 2, now })).used,
        0,
        'a reservation a crash left behind stops counting',
      );

      // The ceiling is $1: each reservation holds 40 cents.
      const others = await Promise.all(Array.from({ length: 5 }, makeUser));
      const ceiling = await Promise.all(
        others.map((other) => reserve(other.id, 10, 400_000)),
      );
      assert.equal(ceiling.filter((result) => result.id !== null).length, 2);
      assert.equal(ceiling.filter((result) => result.refusal === 'PAUSED').length, 3);

      await db.user.delete({ where: { id: member.id } });
      const kept = await db.aiUsageRecord.findUnique({ where: { id: crashed.id } });
      assert.equal(kept?.userId, null);
      assert.equal(kept?.costMicros, 1000);
    } finally {
      await db.aiUsageRecord.deleteMany({ where: { createdAt: { gte: new Date('2031-01-01') } } });
      await db.user.deleteMany({ where: { name: 'Ledger test' } });
      await db.$disconnect();
    }
  },
);
