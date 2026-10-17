import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { Prisma, type EntitlementGrant, type EntitlementSource } from '@prisma/client';
import {
  FEATURE_KEYS,
  PLANS,
  planFromGrants,
  planIncludes,
  isGrantActive,
  type FeatureKey,
} from '@sunsteel/contracts';
import {
  grantPlan,
  grantProblem,
  grantSummaries,
  grantWindows,
  isOpenGrantConflict,
  revokePlan,
} from '../src/billing/entitlement-grants';
import type { EntitlementsService } from '../src/billing/entitlements.service';
import {
  EntitlementGuard,
  REQUIRED_ENTITLEMENT,
  RequiresEntitlement,
} from '../src/billing/requires-entitlement';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR);

function conflict() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/**
 * A store that behaves like Postgres for what the grant functions rely on:
 * each transaction works on what was committed when its statements ran, and
 * the partial unique index on open grants is checked when it commits. A tick
 * before the commit lets two transactions interleave.
 */
function grantStore() {
  const rows: EntitlementGrant[] = [];
  let next = 1;
  const isOpenMatch = (row: EntitlementGrant, where: any) =>
    row.userId === where.userId &&
    row.revokedAt === null &&
    (where.source === undefined || row.source === where.source);
  const db = {
    rows,
    entitlementGrant: {
      updateMany: async ({ where, data }: any) => {
        const matching = rows.filter((row) => isOpenMatch(row, where));
        for (const row of matching) row.revokedAt = data.revokedAt;
        return { count: matching.length };
      },
    },
    $transaction: async (fn: (tx: any) => Promise<EntitlementGrant>) => {
      const revoked: EntitlementGrant[] = [];
      let created: EntitlementGrant | null = null;
      const tx = {
        entitlementGrant: {
          updateMany: async ({ where }: any) => {
            const matching = rows.filter((row) => isOpenMatch(row, where));
            revoked.push(...matching);
            return { count: matching.length };
          },
          create: async ({ data }: any) => {
            created = {
              id: `g${next++}`,
              createdAt: data.startsAt,
              revokedAt: null,
              subscriptionId: null,
              note: null,
              ...data,
            } as EntitlementGrant;
            return created;
          },
        },
      };
      const result = await fn(tx);
      await new Promise((resolve) => setImmediate(resolve));
      for (const row of revoked) if (row.revokedAt === null) row.revokedAt = result.startsAt;
      const grant = created as EntitlementGrant | null;
      if (grant && rows.some((row) => isOpenMatch(row, grant))) throw conflict();
      if (grant) rows.push(grant);
      return result;
    },
  };
  return db;
}

describe('BILL-01 the plan an account is on', () => {
  it('is FREE without a grant, and FREE unlocks nothing', () => {
    assert.equal(planFromGrants([], NOW), 'FREE');
    for (const feature of FEATURE_KEYS) assert.equal(planIncludes('FREE', feature), false);
  });

  it('is PRO while a PRO grant is in force, and PRO unlocks every capability', () => {
    const grant = { planId: 'PRO' as const, startsAt: at(-1), expiresAt: at(1), revokedAt: null };
    assert.equal(planFromGrants([grant], NOW), 'PRO');
    for (const feature of FEATURE_KEYS) assert.equal(planIncludes('PRO', feature), true);
  });

  it('changes at the expiry, which is exclusive, at the start and at a revoke', () => {
    const grant = { planId: 'PRO' as const, startsAt: at(-1), expiresAt: NOW, revokedAt: null };
    assert.equal(isGrantActive(grant, at(-0.001)), true);
    assert.equal(isGrantActive(grant, NOW), false);
    assert.equal(isGrantActive({ ...grant, startsAt: at(1), expiresAt: null }, NOW), false);
    assert.equal(isGrantActive({ ...grant, expiresAt: null, revokedAt: at(-0.5) }, NOW), false);
    assert.equal(isGrantActive({ ...grant, expiresAt: null }, NOW), true);
  });

  it('takes the highest plan when grants from two sources overlap', () => {
    const free = { planId: 'FREE' as const, startsAt: at(-2), expiresAt: null, revokedAt: null };
    const pro = { planId: 'PRO' as const, startsAt: at(-1), expiresAt: at(5), revokedAt: null };
    assert.equal(planFromGrants([free, pro], NOW), 'PRO');
    assert.equal(planFromGrants([pro, free], at(6)), 'FREE');
  });

  it('reads a stored grant naming an unknown plan as no grant', () => {
    const windows = grantWindows([
      { planId: 'GOLD', startsAt: at(-1), expiresAt: null, revokedAt: null },
      { planId: 'PRO', startsAt: at(-1), expiresAt: null, revokedAt: null },
    ]);
    assert.deepEqual(windows.map((window) => window.planId), ['PRO']);
  });

  it('keeps the Free limits under the Pro ones and never above a capability maximum', () => {
    for (const key of Object.keys(PLANS.FREE.limits) as (keyof typeof PLANS.FREE.limits)[]) {
      const free = PLANS.FREE.limits[key];
      const pro = PLANS.PRO.limits[key];
      assert.ok(free !== null);
      assert.ok(pro === null || pro > free, key);
    }
    assert.equal(PLANS.PRO.limits.ROUTINE_VERSIONS, 20);
    assert.equal(PLANS.PRO.limits.GOALS, 8);
  });
});

describe('BILL-01 granting and revoking', () => {
  it('refuses a grant that is over before it starts', () => {
    assert.equal(grantProblem({ expiresAt: NOW }, NOW), 'A grant must expire after it starts');
    assert.equal(grantProblem({ expiresAt: at(1) }, NOW), null);
    assert.equal(grantProblem({ expiresAt: null }, NOW), null);
  });

  it('replaces the source\'s open grant and leaves other sources alone', async () => {
    const db = grantStore();
    const request = { userId: 'u1', planId: 'PRO' as const, expiresAt: null };
    await grantPlan(db as any, { ...request, source: 'PROMO' }, () => NOW);
    await grantPlan(db as any, { ...request, source: 'ADMIN' }, () => at(1));
    await grantPlan(db as any, { ...request, source: 'ADMIN', expiresAt: at(48) }, () => at(2));
    const open = db.rows.filter((row) => row.revokedAt === null);
    assert.deepEqual(open.map((row) => row.source).sort(), ['ADMIN', 'PROMO']);
    assert.equal(open.find((row) => row.source === 'ADMIN')?.expiresAt?.getTime(), at(48).getTime());
    assert.equal(db.rows.length, 3);
  });

  it('leaves exactly one open grant when two grants race', async () => {
    const db = grantStore();
    const request = { userId: 'u1', planId: 'PRO' as const, source: 'ADMIN' as EntitlementSource };
    await Promise.all([
      grantPlan(db as any, { ...request, expiresAt: at(24) }, () => NOW),
      grantPlan(db as any, { ...request, expiresAt: at(72) }, () => NOW),
    ]);
    const open = db.rows.filter((row) => row.revokedAt === null);
    assert.equal(open.length, 1);
    assert.equal(db.rows.length, 2);
  });

  it('gives up on a conflict after the retries, and never retries anything else', async () => {
    let calls = 0;
    const always = { $transaction: async () => { calls += 1; throw conflict(); } };
    await assert.rejects(
      grantPlan(always as any, { userId: 'u', planId: 'PRO', source: 'ADMIN', expiresAt: null }),
      (error: unknown) => isOpenGrantConflict(error),
    );
    assert.equal(calls, 4);
    calls = 0;
    const broken = { $transaction: async () => { calls += 1; throw new Error('down'); } };
    await assert.rejects(
      grantPlan(broken as any, { userId: 'u', planId: 'PRO', source: 'ADMIN', expiresAt: null }),
      /down/,
    );
    assert.equal(calls, 1);
  });

  it('revokes one source or every source, and only open grants', async () => {
    const db = grantStore();
    const request = { userId: 'u1', planId: 'PRO' as const, expiresAt: null };
    await grantPlan(db as any, { ...request, source: 'PROMO' }, () => NOW);
    await grantPlan(db as any, { ...request, source: 'ADMIN' }, () => NOW);
    assert.equal(await revokePlan(db as any, 'u1', 'ADMIN', at(1)), 1);
    assert.equal(await revokePlan(db as any, 'u1', 'ADMIN', at(2)), 0);
    assert.equal(await revokePlan(db as any, 'u1', null, at(3)), 1);
    assert.equal(planFromGrants(grantWindows(db.rows), at(4)), 'FREE');
  });

  it('lists the grants in force with the longest-lasting first', () => {
    const grant = (id: string, expiresAt: Date | null) =>
      ({ id, planId: 'PRO', source: 'ADMIN', startsAt: at(-1), expiresAt, revokedAt: null, note: null, subscriptionId: null, userId: 'u', createdAt: at(-1) }) as EntitlementGrant;
    const summaries = grantSummaries([grant('a', at(5)), grant('b', null), grant('c', at(50))]);
    assert.deepEqual(summaries.map((summary) => summary.id), ['b', 'c', 'a']);
    assert.equal(summaries[0].expiresAt, null);
    assert.equal(summaries[1].expiresAt, at(50).toISOString());
  });
});

describe('BILL-01 the entitlement guard', () => {
  const context = (userId: string | undefined) =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user: userId ? { id: userId } : undefined }) }),
    }) as unknown as ExecutionContext;
  const guardFor = (feature: FeatureKey | undefined, allowed: boolean) =>
    new EntitlementGuard(
      { getAllAndOverride: () => feature } as unknown as Reflector,
      { can: async () => allowed } as unknown as EntitlementsService,
    );

  it('lets a route through without a requirement', async () => {
    assert.equal(await guardFor(undefined, false).canActivate(context('u')), true);
  });

  it('lets an entitled account through and refuses the rest with a coded 403', async () => {
    assert.equal(await guardFor('TRAINING_SIGNALS', true).canActivate(context('u')), true);
    await assert.rejects(
      guardFor('TRAINING_SIGNALS', false).canActivate(context('u')),
      (error: unknown) =>
        error instanceof ForbiddenException &&
        (error.getResponse() as { code?: string }).code === 'ENTITLEMENT_REQUIRED',
    );
  });

  it('puts the requirement and the guard on a route together', () => {
    class Routes {
      @RequiresEntitlement('TRAINING_BLOCKS')
      route() {
        return undefined;
      }
    }
    const handler = Object.getOwnPropertyDescriptor(Routes.prototype, 'route')!.value;
    assert.equal(Reflect.getMetadata(REQUIRED_ENTITLEMENT, handler), 'TRAINING_BLOCKS');
    assert.deepEqual(Reflect.getMetadata('__guards__', handler), [EntitlementGuard]);
  });
});
