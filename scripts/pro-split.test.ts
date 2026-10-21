import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import {
  listWithinLimit,
  PLANS,
  startLinearPeriodization,
  lpAtStep,
  strengthRangeNeedsPro,
} from '@sunsteel/contracts';
import { assertBelowLimit, assertListWithinLimit } from '../src/billing/plan-of';
import {
  historyWeeks,
  keepsProBodyFields,
  pausedGoalIds,
  startsLinearBlock,
} from '../src/billing/pro-split';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-21T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const FREE = PLANS.FREE.limits;
const PRO = PLANS.PRO.limits;

const refusedWith = (code: string, max?: number) => (error: unknown) =>
  error instanceof ForbiddenException &&
  (error.getResponse() as { code?: string }).code === code &&
  (max === undefined ||
    (error.getResponse() as { params?: { max?: number } }).params?.max === max);

describe('BILL-02 strength-trend ranges (PROG-01)', () => {
  it('reads 30 and 90 days on Free, with slack for clocks and months', () => {
    assert.equal(strengthRangeNeedsPro({ from: daysAgo(30), to: NOW }), false);
    assert.equal(strengthRangeNeedsPro({ from: daysAgo(90), to: NOW }), false);
    assert.equal(strengthRangeNeedsPro({ from: daysAgo(92), to: NOW }), false);
  });

  it('needs Pro for six months, a year and all time', () => {
    assert.equal(strengthRangeNeedsPro({ from: daysAgo(183), to: NOW }), true);
    assert.equal(strengthRangeNeedsPro({ from: daysAgo(365), to: NOW }), true);
    assert.equal(strengthRangeNeedsPro({ from: null, to: NOW }), true);
  });
});

describe('BILL-02 muscle history (PROG-03, PROG-04)', () => {
  it('gives Free four weeks by default and refuses more', () => {
    assert.deepEqual(historyWeeks(undefined, 8, FREE.MUSCLE_HISTORY_WEEKS), { weeks: 4, overLimit: false });
    assert.deepEqual(historyWeeks(4, 8, FREE.MUSCLE_HISTORY_WEEKS), { weeks: 4, overLimit: false });
    assert.equal(historyWeeks(8, 8, FREE.MUSCLE_HISTORY_WEEKS).overLimit, true);
    assert.equal(historyWeeks(12, 8, FREE.MUSCLE_HISTORY_WEEKS).overLimit, true);
  });

  it('gives Pro the default and up to twelve', () => {
    assert.deepEqual(historyWeeks(undefined, 8, PRO.MUSCLE_HISTORY_WEEKS), { weeks: 8, overLimit: false });
    assert.equal(historyWeeks(12, 8, PRO.MUSCLE_HISTORY_WEEKS).overLimit, false);
  });
});

describe('BILL-02 goals past the limit are paused, never deleted (PROG-08)', () => {
  const ids = ['g1', 'g2', 'g3', 'g4', 'g5'];

  it('pauses the goals after the first three on Free, in stored order', () => {
    assert.deepEqual([...pausedGoalIds(ids, FREE.GOALS)], ['g4', 'g5']);
  });

  it('pauses nothing within the Pro limit', () => {
    assert.equal(pausedGoalIds(ids, PRO.GOALS).size, 0);
  });
});

describe('BILL-02 replace-the-list writes past the limit (goals, locations)', () => {
  const stored = ['a', 'b', 'c', 'd', 'e'];

  it('allows anything within the limit, a new item included', () => {
    assert.equal(listWithinLimit(3, ['a', undefined, 'c'], stored), true);
  });

  it('lets a downgraded member keep, edit and drop what they hold', () => {
    assert.equal(listWithinLimit(3, stored, stored), true);
    assert.equal(listWithinLimit(3, ['a', 'b', 'c', 'd'], stored), true);
  });

  it('refuses a new item past the limit', () => {
    assert.equal(listWithinLimit(3, [...stored, undefined], stored), false);
    assert.equal(listWithinLimit(1, ['home', undefined], ['home']), false);
    assert.throws(
      () => assertListWithinLimit(3, ['a', 'b', 'c', null], ['a', 'b', 'c']),
      refusedWith('PLAN_LIMIT_REACHED', 3),
    );
  });

  it('applies no limit of its own where the plan has none', () => {
    assert.doesNotThrow(() => assertListWithinLimit(null, ['x', null, null], []));
  });
});

describe('BILL-02 routine versions (ROUT-08)', () => {
  it('keeps every version past the limit and adds none', () => {
    assert.doesNotThrow(() => assertBelowLimit(FREE.ROUTINE_VERSIONS, 2));
    assert.throws(() => assertBelowLimit(FREE.ROUTINE_VERSIONS, 3), refusedWith('PLAN_LIMIT_REACHED', 3));
    assert.throws(() => assertBelowLimit(FREE.ROUTINE_VERSIONS, 7), refusedWith('PLAN_LIMIT_REACHED', 3));
    assert.doesNotThrow(() => assertBelowLimit(PRO.ROUTINE_VERSIONS, 7));
  });
});

describe('BILL-02 8-week blocks (ROUT-17 to ROUT-20)', () => {
  const LP = 'LINEAR_PERIODIZATION';
  const block = startLinearPeriodization(100, 1);
  const squat = { exerciseId: 'squat', progressionScheme: LP, linearPeriodization: block };

  it('starts a block when a routine is created with one', () => {
    assert.equal(startsLinearBlock([squat], []), true);
  });

  it('lets a running block travel with an edit, so it finishes after a downgrade', () => {
    const stored = [{ exerciseId: 'squat', linearPeriodization: JSON.parse(JSON.stringify(block)) }];
    assert.equal(startsLinearBlock([squat], stored), false);
  });

  it('counts another reference, another week or another lift as a new block', () => {
    const stored = [{ exerciseId: 'squat', linearPeriodization: block }];
    assert.equal(startsLinearBlock([{ ...squat, linearPeriodization: startLinearPeriodization(110, 1) }], stored), true);
    assert.equal(startsLinearBlock([{ ...squat, linearPeriodization: lpAtStep(block, 3) }], stored), true);
    assert.equal(startsLinearBlock([{ ...squat, exerciseId: 'bench' }], stored), true);
  });

  it('starts nothing for the scheme without a reference, or any other scheme', () => {
    assert.equal(startsLinearBlock([{ ...squat, linearPeriodization: null }], []), false);
    assert.equal(startsLinearBlock([{ ...squat, progressionScheme: 'DOUBLE_PROGRESSION' }], []), false);
  });
});

describe('BILL-02 body measurements beyond weight (PROG-12)', () => {
  it('lets Free log weight on a day with nothing else', () => {
    assert.equal(keepsProBodyFields({}, null), true);
  });

  it('needs Pro to add a measurement', () => {
    assert.equal(keepsProBodyFields({ waistCm: 80 }, null), false);
    assert.equal(keepsProBodyFields({ waistCm: 81 }, { waistCm: 80 }), false);
  });

  it('keeps stored measurements read-only: sent back unchanged they pass, cleared they do not', () => {
    const stored = { waistCm: 80, bodyFatPercent: 15 };
    assert.equal(keepsProBodyFields({ waistCm: 80, bodyFatPercent: 15 }, stored), true);
    assert.equal(keepsProBodyFields({ waistCm: 80 }, stored), false);
  });
});

describe('BILL-02 founding members', () => {
  const sql = readFileSync(
    'prisma/migrations/20261021100000_founding_member_grants/migration.sql',
    'utf8',
  );

  it('grants every existing account a non-expiring Pro promotion', () => {
    assert.match(sql, /'PRO', 'PROMO'/);
    assert.match(sql, /NULL, 'Founding member'/);
    assert.match(sql, /FROM "User" u/);
  });

  it('never grants twice, nor again once revoked', () => {
    assert.match(sql, /NOT EXISTS/);
    assert.match(sql, /"revokedAt" IS NULL OR g\."note" = 'Founding member'/);
  });
});
