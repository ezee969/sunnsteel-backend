import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Prisma } from '@prisma/client';
import { DEFAULT_DASHBOARD_LAYOUT } from '@sunsteel/contracts';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DatabaseService } from '../src/database/database.service';
import { UpdateDashboardLayoutDto } from '../src/users/dto/update-dashboard-layout.dto';
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
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  _count: { followers: 0, following: 0 },
  favoriteExercises: [],
};

function setup() {
  const writes: unknown[] = [];
  const db = {
    user: {
      update: async (args: { data: { dashboardLayout: unknown } }) => {
        writes.push(args.data.dashboardLayout);
        return {
          ...stored,
          dashboardLayout:
            args.data.dashboardLayout === Prisma.DbNull
              ? null
              : args.data.dashboardLayout,
        };
      },
    },
  } as unknown as DatabaseService;
  return { service: new UsersService(db), writes };
}

describe('DASH-05 / PREF-03 dashboard layout', () => {
  it('stores the normalized layout and answers it on the profile', async () => {
    const { service, writes } = setup();
    const profile = await service.updateDashboardLayout('owner@example.test', [
      { id: 'following', hidden: false },
      { id: 'stats', hidden: true },
      { id: 'following', hidden: true },
    ]);
    assert.deepEqual(
      profile.dashboardLayout?.map((entry) => [entry.id, entry.hidden]),
      [
        ['this-week', false],
        ['following', false],
        ['stats', true],
        ['recent-activity', false],
        ['personal-records', false],
        ['training-insights', false],
        ['upcoming-milestones', false],
      ],
    );
    assert.equal(Array.isArray(writes[0]), true);
  });

  it('stores null for the default layout, so the default keeps applying', async () => {
    const { service, writes } = setup();
    const profile = await service.updateDashboardLayout(
      'owner@example.test',
      DEFAULT_DASHBOARD_LAYOUT,
    );
    assert.equal(writes[0], Prisma.DbNull);
    assert.deepEqual(profile.dashboardLayout, DEFAULT_DASHBOARD_LAYOUT);
  });

  it('refuses an unknown section, a missing flag and too many entries', async () => {
    const problems = async (body: unknown) =>
      (await validate(plainToInstance(UpdateDashboardLayoutDto, body))).length;
    assert.equal(
      await problems({ sections: [{ id: 'stats', hidden: false }] }),
      0,
    );
    assert.ok(await problems({ sections: [{ id: 'calendar', hidden: false }] }));
    assert.ok(await problems({ sections: [{ id: 'stats' }] }));
    assert.ok(
      await problems({
        sections: Array.from({ length: 8 }, () => ({
          id: 'stats',
          hidden: false,
        })),
      }),
    );
  });
});
