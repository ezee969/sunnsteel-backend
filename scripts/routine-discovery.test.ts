import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveRoutineFacets,
  durationBand,
  estimateDaySeconds,
  matchesDiscoveryFilters,
  SECONDS_PER_REP,
  SETUP_SECONDS_PER_EXERCISE,
  type FacetDay,
} from '../src/routines/routine-facets';
import type { MuscleGroup } from '@sunsteel/contracts';

const exercise = (
  overrides: {
    restSeconds?: number;
    reps?: number;
    sets?: number;
    primary?: MuscleGroup[];
    secondary?: MuscleGroup[];
    equipment?: string[];
  } = {},
) => ({
  restSeconds: overrides.restSeconds ?? 60,
  sets: Array.from({ length: overrides.sets ?? 3 }, () => ({
    repType: 'FIXED' as const,
    reps: overrides.reps ?? 10,
    minReps: null,
    maxReps: null,
  })),
  exercise: {
    primaryMuscles: overrides.primary ?? ['PECTORAL'],
    secondaryMuscles: overrides.secondary ?? ['TRICEPS'],
    equipmentRequired: overrides.equipment ?? ['barbell'],
  },
});

describe('ROUT-07 duration estimate', () => {
  it('is ROUT-10 rule: setup, work and rest', () => {
    // One exercise, three sets of ten, sixty seconds rest.
    const day: FacetDay = { exercises: [exercise()] };
    const expected =
      SETUP_SECONDS_PER_EXERCISE + 3 * (10 * SECONDS_PER_REP + 60);
    assert.equal(estimateDaySeconds(day), expected);
  });

  it('judges a rep range by its top end, not its middle', () => {
    // A range is a target the lifter may reach, so the estimate must not be
    // optimistic about how long the day takes.
    const day: FacetDay = {
      exercises: [
        {
          restSeconds: 0,
          sets: [
            { repType: 'RANGE', reps: null, minReps: 6, maxReps: 10 },
          ],
          exercise: {
            primaryMuscles: [],
            secondaryMuscles: [],
            equipmentRequired: [],
          },
        },
      ],
    };
    assert.equal(
      estimateDaySeconds(day),
      SETUP_SECONDS_PER_EXERCISE + 10 * SECONDS_PER_REP,
    );
  });

  it('bands by the published thresholds', () => {
    assert.equal(durationBand(30), 'SHORT');
    assert.equal(durationBand(45), 'SHORT');
    assert.equal(durationBand(46), 'MEDIUM');
    assert.equal(durationBand(75), 'MEDIUM');
    assert.equal(durationBand(76), 'LONG');
  });
});

describe('ROUT-07 derived facets', () => {
  it('reports the LONGEST day, because that is what has to fit', () => {
    const facets = deriveRoutineFacets([
      { exercises: [exercise({ sets: 1, reps: 5, restSeconds: 0 })] },
      { exercises: [exercise({ sets: 10, reps: 10, restSeconds: 180 })] },
    ]);
    assert.equal(facets.dayCount, 2);
    assert.equal(facets.exerciseCount, 2);
    const longest =
      SETUP_SECONDS_PER_EXERCISE + 10 * (10 * SECONDS_PER_REP + 180);
    assert.equal(facets.longestDayMinutes, Math.round(longest / 60));
  });

  it('counts a secondary mover as trained, deduplicated and sorted', () => {
    // Hiding secondary movers would make the muscle filter answer a narrower
    // question than the one it asks.
    const facets = deriveRoutineFacets([
      {
        exercises: [
          exercise({ primary: ['PECTORAL'], secondary: ['TRICEPS'] }),
          exercise({ primary: ['TRICEPS'], secondary: ['PECTORAL'] }),
        ],
      },
    ]);
    assert.deepEqual(facets.muscles, ['PECTORAL', 'TRICEPS']);
  });

  it('collects every piece of equipment the routine needs, once', () => {
    const facets = deriveRoutineFacets([
      {
        exercises: [
          exercise({ equipment: ['barbell', 'bench'] }),
          exercise({ equipment: ['barbell'] }),
          exercise({ equipment: [] }),
        ],
      },
    ]);
    assert.deepEqual(facets.equipment, ['barbell', 'bench']);
  });

  it('treats an empty routine as zero rather than throwing', () => {
    const facets = deriveRoutineFacets([]);
    assert.deepEqual(facets, {
      dayCount: 0,
      exerciseCount: 0,
      muscles: [],
      equipment: [],
      longestDayMinutes: 0,
    });
  });
});

describe('ROUT-07 filters', () => {
  const candidate = {
    ...deriveRoutineFacets([
      { exercises: [exercise({ equipment: ['barbell', 'bench'] })] },
      { exercises: [exercise({ equipment: ['barbell'] })] },
    ]),
    name: 'Upper / Lower',
    description: 'Four days, alternating.',
    goal: 'STRENGTH',
    experienceLevel: 'INTERMEDIATE',
  };

  it('matches everything when nothing is asked', () => {
    assert.equal(matchesDiscoveryFilters(candidate, {}), true);
  });

  it('never returns an undeclared claim as though it were made', () => {
    // A routine whose author said nothing about its goal must not answer a
    // goal filter; that would put a claim in their mouth.
    const undeclared = { ...candidate, goal: null, experienceLevel: null };
    assert.equal(
      matchesDiscoveryFilters(undeclared, { goal: 'STRENGTH' }),
      false,
    );
    assert.equal(
      matchesDiscoveryFilters(undeclared, { experienceLevel: 'BEGINNER' }),
      false,
    );
    // ...but it is still discoverable when those filters are not applied.
    assert.equal(matchesDiscoveryFilters(undeclared, { days: 2 }), true);
  });

  it('reads equipment as what the viewer HAS, not what the routine uses', () => {
    // Selecting equipment asks "what can I actually do", so a routine matches
    // only when it needs nothing outside the selection.
    assert.equal(
      matchesDiscoveryFilters(candidate, { equipment: ['barbell'] }),
      false,
      'a bench is needed and was not offered',
    );
    assert.equal(
      matchesDiscoveryFilters(candidate, { equipment: ['barbell', 'bench'] }),
      true,
    );
    assert.equal(
      matchesDiscoveryFilters(candidate, {
        equipment: ['barbell', 'bench', 'dumbbell'],
      }),
      true,
      'more equipment than needed still matches',
    );
  });

  it('matches bodyweight routines whatever equipment is selected', () => {
    const bodyweight = {
      ...candidate,
      ...deriveRoutineFacets([
        { exercises: [exercise({ equipment: [] })] },
      ]),
    };
    assert.equal(
      matchesDiscoveryFilters(bodyweight, { equipment: ['barbell'] }),
      true,
    );
    assert.equal(matchesDiscoveryFilters(bodyweight, { equipment: [] }), true);
  });

  it('matches name and description case-insensitively', () => {
    assert.equal(matchesDiscoveryFilters(candidate, { q: 'UPPER' }), true);
    assert.equal(matchesDiscoveryFilters(candidate, { q: 'alternating' }), true);
    assert.equal(matchesDiscoveryFilters(candidate, { q: 'squat' }), false);
  });

  it('applies days, muscle and duration exactly', () => {
    assert.equal(matchesDiscoveryFilters(candidate, { days: 2 }), true);
    assert.equal(matchesDiscoveryFilters(candidate, { days: 3 }), false);
    assert.equal(matchesDiscoveryFilters(candidate, { muscle: 'PECTORAL' }), true);
    assert.equal(matchesDiscoveryFilters(candidate, { muscle: 'QUADRICEPS' }), false);
    assert.equal(
      matchesDiscoveryFilters(candidate, {
        duration: durationBand(candidate.longestDayMinutes),
      }),
      true,
    );
  });

  it('requires every applied filter, not any of them', () => {
    assert.equal(
      matchesDiscoveryFilters(candidate, { goal: 'STRENGTH', days: 3 }),
      false,
    );
    assert.equal(
      matchesDiscoveryFilters(candidate, { goal: 'STRENGTH', days: 2 }),
      true,
    );
  });
});
