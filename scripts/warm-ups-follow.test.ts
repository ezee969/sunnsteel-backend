import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildWarmUpRamp,
  followWorkingLoad,
  leadWorkingWeight,
  PLATE_SETS,
} from '@sunsteel/contracts';

import { syncFollowingWarmUps } from '../src/routines/warm-up-follow';

const barbell = {
  barLoaded: true,
  barWeightKg: 20,
  platePairs: PLATE_SETS.KG.STANDARD,
  incrementKg: 2.5,
};

const set = (
  setNumber: number,
  kind: 'WARMUP' | 'WORKING' | 'DROP',
  weight: number,
  warmUpShare: number | null = null,
) => ({ id: `set-${setNumber}`, setNumber, kind, weight, warmUpShare });

describe('warm-ups follow the working load (LIVE-20)', () => {
  it('recalculates every warm-up with a share from the first working set', () => {
    const sets = [
      set(1, 'WARMUP', 20, 0),
      set(2, 'WARMUP', 40, 0.4),
      set(3, 'WARMUP', 60, 0.6),
      set(4, 'WARMUP', 80, 0.8),
      set(5, 'WORKING', 105),
      set(6, 'WORKING', 105),
    ];
    const next = followWorkingLoad(sets, barbell);
    assert.deepEqual(
      next.map((s) => s.weight),
      // 42, 63 and 84, each rounded down to what the plates make.
      [20, 40, 62.5, 82.5, 105, 105],
    );
  });

  it('leaves a warm-up without a share, and every other set, as written', () => {
    const sets = [
      set(1, 'WARMUP', 30),
      set(2, 'WARMUP', 40, 0.4),
      set(3, 'WORKING', 120),
      set(4, 'DROP', 90),
    ];
    const next = followWorkingLoad(sets, barbell);
    assert.deepEqual(
      next.map((s) => s.weight),
      [30, 47.5, 120, 90],
    );
  });

  it('leads with the first working set, not with a warm-up or drop', () => {
    assert.equal(
      leadWorkingWeight([set(1, 'WARMUP', 20, 0), set(2, 'WORKING', 100)]),
      100,
    );
    const noLoad = [set(1, 'WARMUP', 20, 0.4), set(2, 'WORKING', 0)];
    assert.deepEqual(followWorkingLoad(noLoad, barbell), noLoad);
  });

  it('rounds non-bar work down to the exercise step', () => {
    const next = followWorkingLoad(
      [set(1, 'WARMUP', 14, 0.5), set(2, 'WORKING', 34)],
      { barLoaded: false, barWeightKg: 0, platePairs: [], incrementKg: 2 },
    );
    assert.equal(next[0].weight, 16);
  });

  it('matches what the builder generated for the same load', () => {
    const ramp = buildWarmUpRamp({ ...barbell, workingWeightKg: 100, room: 10 });
    const sets = [
      ...ramp.sets.map((w, i) => set(i + 1, 'WARMUP', w.weightKg, w.share)),
      set(ramp.sets.length + 1, 'WORKING', 100),
    ];
    assert.deepEqual(
      followWorkingLoad(sets, barbell).map((s) => s.weight),
      sets.map((s) => s.weight),
    );
  });
});

function fakeTx(options: {
  location?: { barWeightKg: number; availablePlatePairs: unknown } | null;
  weightUnit?: 'KG' | 'LB';
}) {
  const updates: Array<{ id: string; weight: number }> = [];
  let asked: any;
  const tx = {
    routineExercise: {
      findMany: async (args: any) => {
        asked = args;
        return [
          {
            id: 'rx-1',
            minWeightIncrement: 2.5,
            exercise: { equipmentRequired: ['barbell', 'rack'] },
            sets: [
              set(1, 'WARMUP', 20, 0),
              set(2, 'WARMUP', 40, 0.4),
              set(3, 'WORKING', 110),
            ],
          },
        ];
      },
    },
    trainingLocationPreference: {
      findFirst: async () => options.location ?? null,
    },
    user: {
      findUnique: async () => ({ weightUnit: options.weightUnit ?? 'KG' }),
    },
    routineExerciseSet: {
      update: async ({ where, data }: any) => {
        updates.push({ id: where.id, weight: data.weight });
        return { id: where.id };
      },
    },
  };
  return { tx: tx as any, updates, asked: () => asked };
}

describe('the server recalculates following warm-ups (LIVE-20)', () => {
  it('asks only for exercises that follow, and writes only what changed', async () => {
    const fake = fakeTx({
      location: {
        barWeightKg: 20,
        availablePlatePairs: PLATE_SETS.KG.STANDARD,
      },
    });
    const changed = await syncFollowingWarmUps(fake.tx, 'user-1', [
      'rx-1',
      'rx-1',
    ]);
    assert.deepEqual(fake.asked().where, {
      id: { in: ['rx-1'] },
      warmUpsFollowLoad: true,
    });
    assert.equal(changed, 1);
    assert.deepEqual(fake.updates, [{ id: 'set-2', weight: 42.5 }]);
  });

  it('uses the saved plates, and a standard set when none are saved', async () => {
    const coarse = fakeTx({
      location: {
        barWeightKg: 20,
        availablePlatePairs: [{ weightKg: 10, pairCount: 2 }],
      },
    });
    await syncFollowingWarmUps(coarse.tx, 'user-1', ['rx-1']);
    // 40 % of 110 is 44: a 20 kg bar and 10 kg pairs make 40.
    assert.deepEqual(coarse.updates, []);

    const none = fakeTx({ location: null });
    await syncFollowingWarmUps(none.tx, 'user-1', ['rx-1']);
    assert.deepEqual(none.updates, [{ id: 'set-2', weight: 42.5 }]);
  });

  it('does nothing without exercises to follow', async () => {
    const fake = fakeTx({});
    assert.equal(await syncFollowingWarmUps(fake.tx, 'user-1', []), 0);
    assert.equal(fake.asked(), undefined);
  });
});
