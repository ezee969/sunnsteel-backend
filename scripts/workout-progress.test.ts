import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeStreaks } from '../src/workouts/workout-progress.service';

const TODAY = '2026-09-06';

test('rest days inside the tolerance keep a streak intact', () => {
  // Mon, Tue, Thu, Fri -- the gaps are 1, 2 and 3 days.
  const days = ['2026-08-31', '2026-09-01', '2026-09-03', '2026-09-04'];
  assert.deepEqual(computeStreaks(days, TODAY), { current: 4, best: 4 });
});

test('a skipped week breaks the run and only the recent chain is current', () => {
  const days = [
    '2026-08-10',
    '2026-08-11',
    '2026-08-13',
    // week off
    '2026-08-31',
    '2026-09-01',
    '2026-09-03',
  ];
  assert.deepEqual(computeStreaks(days, TODAY), { current: 3, best: 3 });
});

test('best streak is remembered after the current one breaks', () => {
  const days = [
    '2026-07-06',
    '2026-07-07',
    '2026-07-09',
    '2026-07-10',
    '2026-07-13',
    // long gap
    '2026-09-04',
  ];
  const { current, best } = computeStreaks(days, TODAY);
  assert.equal(best, 5);
  assert.equal(current, 1);
});

test('a stale last session yields no current streak', () => {
  const days = ['2026-08-20', '2026-08-21', '2026-08-24'];
  assert.deepEqual(computeStreaks(days, TODAY), { current: 0, best: 3 });
});

test('duplicate days in one calendar day count once', () => {
  const days = ['2026-09-04', '2026-09-04', '2026-09-05'];
  assert.deepEqual(computeStreaks(days, TODAY), { current: 2, best: 2 });
});

test('no history is not a streak', () => {
  assert.deepEqual(computeStreaks([], TODAY), { current: 0, best: 0 });
});
