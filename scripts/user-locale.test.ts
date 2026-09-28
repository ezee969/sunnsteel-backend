import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DatabaseService } from '../src/database/database.service';
import { UpdateLocaleDto } from '../src/users/dto/update-locale.dto';
import { UsersService } from '../src/users/users.service';

const stored = {
  timeZone: 'UTC',
  id: 'user-1',
  email: 'owner@example.test',
  username: 'owner',
  name: 'Owner',
  lastName: null,
  avatarUrl: null,
  bio: null,
  location: null,
  trainingGoals: [],
  trainingExperienceLevel: null,
  trainingDisciplines: [],
  preferredTrainingStyle: null,
  age: null,
  sex: null,
  weight: null,
  height: null,
  weightUnit: 'KG' as const,
  bioVisibility: 'PRIVATE' as const,
  locationVisibility: 'PRIVATE' as const,
  trainingIdentityVisibility: 'PRIVATE' as const,
  historyVisibility: 'PRIVATE' as const,
  recordsVisibility: 'PRIVATE' as const,
  routinesVisibility: 'PRIVATE' as const,
  achievementsVisibility: 'PRIVATE' as const,
  bodyMetricsVisibility: 'PRIVATE' as const,
  bodyProgressVisibility: 'PRIVATE' as const,
  discoverableByName: true,
  discoverableByUsername: true,
  discoverableByContacts: false,
  isModerator: false,
  dashboardLayout: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  _count: { followers: 0, following: 0 },
  favoriteExercises: [],
};

function setup(storedLocale?: string | null) {
  const writes: unknown[] = [];
  const db = {
    user: {
      update: async (args: { data: { locale: unknown } }) => {
        writes.push(args.data.locale);
        return { ...stored, locale: storedLocale ?? args.data.locale };
      },
    },
  } as unknown as DatabaseService;
  return { service: new UsersService(db), writes };
}

describe('I18N-02 account language', () => {
  it('stores a language and answers it on the profile', async () => {
    const { service, writes } = setup();
    const profile = await service.updateLocale('owner@example.test', 'es');
    assert.deepEqual(writes, ['es']);
    assert.equal(profile.locale, 'es');
  });

  it('stores null to follow each device', async () => {
    const { service, writes } = setup();
    const profile = await service.updateLocale('owner@example.test', null);
    assert.deepEqual(writes, [null]);
    assert.equal(profile.locale, null);
  });

  it('never answers a stored value it does not speak', async () => {
    const { service } = setup('fr');
    const profile = await service.updateLocale('owner@example.test', 'en');
    assert.equal(profile.locale, null);
  });

  it('accepts en, es and null, and refuses anything else or nothing', async () => {
    const problems = async (body: unknown) =>
      (await validate(plainToInstance(UpdateLocaleDto, body))).length;
    assert.equal(await problems({ locale: 'en' }), 0);
    assert.equal(await problems({ locale: 'es' }), 0);
    assert.equal(await problems({ locale: null }), 0);
    assert.ok(await problems({ locale: 'fr' }));
    assert.ok(await problems({ locale: 'ES' }));
    assert.ok(await problems({}));
  });
});
