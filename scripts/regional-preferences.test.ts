import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cmToFeetInches,
  cmToInches,
  DEFAULT_WEEK_STARTS_ON,
  feetInchesToCm,
  inchesToCm,
  isWeekStartsOn,
  weekStartOf,
} from '@sunsteel/contracts';
import { weekDate } from '../src/workouts/analytics/analytics-contribution';
import { getHeatmapWeekStarts } from '../src/workouts/workout-muscle-heatmap.service';

describe('PREF-04 week start', () => {
  it('starts a week on Monday by default, exactly as the WEEK rollups do', () => {
    assert.equal(DEFAULT_WEEK_STARTS_ON, 1);
    for (const date of [
      '2026-10-04', // a Sunday
      '2026-10-05', // a Monday
      '2027-01-01', // across a year boundary
      '2026-03-29', // the European clocks change that Sunday
      '2026-11-01', // and the American ones this one
    ]) {
      assert.equal(weekStartOf(date), weekDate(date), date);
    }
  });

  it('puts a Sunday at the start of its own week when weeks start on Sunday', () => {
    assert.equal(weekStartOf('2026-10-04', 0), '2026-10-04');
    assert.equal(weekStartOf('2026-10-10', 0), '2026-10-04');
    assert.equal(weekStartOf('2026-10-11', 0), '2026-10-11');
    assert.equal(weekStartOf('2026-10-04', 1), '2026-09-28');
    assert.equal(weekStartOf('2027-01-02', 0), '2026-12-27');
  });

  it('accepts only Monday and Sunday', () => {
    assert.equal(isWeekStartsOn(1), true);
    assert.equal(isWeekStartsOn(0), true);
    assert.equal(isWeekStartsOn(6), false);
    assert.equal(isWeekStartsOn('1'), false);
  });

  it('lists the weekly charts\' weeks from the member\'s current week', () => {
    assert.deepEqual(getHeatmapWeekStarts(weekStartOf('2026-10-07', 0), 3), [
      '2026-09-20',
      '2026-09-27',
      '2026-10-04',
    ]);
  });
});

describe('PREF-04 length unit', () => {
  it('converts lengths both ways to two decimals', () => {
    assert.equal(cmToInches(81.28), 32);
    assert.equal(inchesToCm(32), 81.28);
    assert.equal(feetInchesToCm(5, 11), 180.34);
  });

  it('reads a height as whole feet and inches, never 12 inches', () => {
    assert.deepEqual(cmToFeetInches(180.34), { feet: 5, inches: 11 });
    assert.deepEqual(cmToFeetInches(182.88), { feet: 6, inches: 0 });
    assert.deepEqual(cmToFeetInches(182.84), { feet: 6, inches: 0 });
    assert.deepEqual(cmToFeetInches(182.7), { feet: 5, inches: 11.9 });
  });
});
