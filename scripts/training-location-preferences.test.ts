import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { DatabaseService } from '../src/database/database.service';
import { normalizeTrainingLocations } from '../src/users/training-location-preferences.logic';
import { TrainingLocationPreferencesService } from '../src/users/training-location-preferences.service';

test('normalizes equipment and presents plates heaviest first', () => {
  const [location] = normalizeTrainingLocations([
    {
      name: '  Home Gym  ',
      isDefault: true,
      barWeightKg: 20,
      availablePlatePairs: [
        { weightKg: 5, pairCount: 2 },
        { weightKg: 20, pairCount: 1 },
      ],
      equipment: [' Barbell ', 'rack', 'BARBELL', ''],
    },
  ]);

  assert.equal(location.name, 'Home Gym');
  assert.deepEqual(location.availablePlatePairs, [
    { weightKg: 20, pairCount: 1 },
    { weightKg: 5, pairCount: 2 },
  ]);
  assert.deepEqual(location.equipment, ['barbell', 'rack']);
});

test('requires exactly one default and unique location names', () => {
  const base = {
    isDefault: false,
    barWeightKg: 20,
    availablePlatePairs: [],
    equipment: [],
  };

  assert.throws(
    () =>
      normalizeTrainingLocations([
        { ...base, name: 'Gym' },
        { ...base, name: ' gym ' },
      ]),
    /Exactly one training location must be the default/,
  );

  assert.throws(
    () =>
      normalizeTrainingLocations([
        { ...base, name: 'Gym', isDefault: true },
        { ...base, name: ' gym ' },
      ]),
    /Training location names must be unique/,
  );
});

test('rejects location ids owned by another account before writing', async () => {
  let deleted = false;
  const transaction = {
    trainingLocationPreference: {
      count: async () => 0,
      deleteMany: async () => {
        deleted = true;
      },
    },
  };
  const db = {
    $transaction: async (callback: (value: typeof transaction) => unknown) =>
      callback(transaction),
  };
  const service = new TrainingLocationPreferencesService(
    db as unknown as DatabaseService,
  );

  await assert.rejects(
    service.replace('owner', [
      {
        id: '36fa1a79-ed21-4e15-82cc-f2ab13b83d9d',
        name: 'Gym',
        isDefault: true,
        barWeightKg: 20,
        availablePlatePairs: [],
        equipment: [],
      },
    ]),
    /do not belong to this account/,
  );
  assert.equal(deleted, false);
});
