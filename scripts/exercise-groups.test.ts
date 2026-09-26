import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canLinkToNext,
  exerciseGroupLabel,
  exerciseGroupPosition,
  exerciseGroups,
  hasOversizedGroup,
  normalizeExerciseLinks,
} from '@sunsteel/contracts';

import {
  assertExerciseLinks,
  dayExerciseLinks,
} from '../src/routines/exercise-links';

const day = (...links: boolean[]) => links.map((linkedToNext) => ({ linkedToNext }));

describe('supersets and circuits (ROUT-12)', () => {
  it('reads groups as unbroken runs of links, lettered in order', () => {
    const groups = exerciseGroups(day(true, false, true, true, false, false));
    assert.deepEqual(groups, [
      { letter: 'A', kind: 'SUPERSET', indices: [0, 1] },
      { letter: 'B', kind: 'CIRCUIT', indices: [2, 3, 4] },
    ]);
    assert.equal(exerciseGroupPosition(day(true, false, false), 2), null);
    assert.equal(
      exerciseGroupLabel(exerciseGroupPosition(day(true, false, true, true, false), 4)!),
      'Circuit B3',
    );
  });

  it('never lets the last exercise of a day link', () => {
    assert.deepEqual(exerciseGroups(day(false, true)), []);
    assert.deepEqual(
      normalizeExerciseLinks(day(true, true)).map((e) => e.linkedToNext),
      [true, false],
    );
  });

  it('stops a group at six exercises', () => {
    const five = day(true, true, true, true, false, false);
    assert.equal(canLinkToNext(five, 4), true);
    const six = day(true, true, true, true, true, false, false);
    assert.equal(canLinkToNext(six, 5), false);
    assert.equal(canLinkToNext(six, 6), false, 'the last exercise has no next');
    assert.equal(hasOversizedGroup(day(true, true, true, true, true, true, false)), true);
    assert.equal(hasOversizedGroup(six), false);
  });

  it('stores links in training order, whatever order they arrive in', () => {
    const links = dayExerciseLinks([
      { order: 2, linkedToNext: true },
      { order: 0, linkedToNext: true },
      { order: 1, linkedToNext: false },
    ]);
    // Trained 0, 1, 2: the exercise at order 2 is last, so its link drops.
    assert.deepEqual(links, [false, true, false]);
  });

  it('refuses a routine day with a group of seven', () => {
    assert.throws(
      () =>
        assertExerciseLinks([
          { exercises: day(true, true, true, true, true, true, false) },
        ]),
      /at most 6 exercises/,
    );
    assertExerciseLinks([{ exercises: day(true, true, false) }]);
  });
});
