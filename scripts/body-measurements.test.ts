import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { BodyMeasurementValues } from '@sunsteel/contracts';
import { DatabaseService } from '../src/database/database.service';
import {
  buildBodyProgress,
  isAllowedEntryDate,
  isSameWeight,
  parseBodyProgressRange,
  type BodyMeasurementRow,
} from '../src/users/body-measurement-rules';
import { BodyMeasurementsService } from '../src/users/body-measurements.service';
import { syncCurrentWeight } from '../src/users/body-weight-sync';
import { UsersService } from '../src/users/users.service';

const empty: BodyMeasurementValues = {
  weightKg: null,
  waistCm: null,
  hipsCm: null,
  chestCm: null,
  armCm: null,
  thighCm: null,
  bodyFatPercent: null,
};

const row = (
  date: string,
  values: Partial<typeof empty>,
): BodyMeasurementRow => ({
  ...empty,
  ...values,
  date: new Date(`${date}T00:00:00Z`),
  createdAt: new Date(`${date}T08:00:00Z`),
  updatedAt: new Date(`${date}T08:00:00Z`),
});

describe('PROG-12 body measurement rules', () => {
  it('defaults the range to 90 days and refuses an unknown one', () => {
    assert.equal(parseBodyProgressRange(undefined), '90D');
    assert.equal(parseBodyProgressRange('1Y'), '1Y');
    assert.equal(parseBodyProgressRange('2Y'), null);
  });

  it('allows an entry up to one day after local today, never further', () => {
    assert.equal(isAllowedEntryDate('2026-09-27', '2026-09-27'), true);
    assert.equal(isAllowedEntryDate('2026-09-28', '2026-09-27'), true);
    assert.equal(isAllowedEntryDate('2026-09-29', '2026-09-27'), false);
    assert.equal(isAllowedEntryDate('2025-01-01', '2026-09-27'), true);
  });

  it('treats two-decimal pound round trips as the same weight', () => {
    assert.equal(isSameWeight(80, 80.004), true);
    assert.equal(isSameWeight(80, 80.1), false);
    assert.equal(isSameWeight(null, 80), false);
  });

  it("lists the range's entries oldest first and summarises every entry", () => {
    const progress = buildBodyProgress(
      [
        row('2026-09-20', { weightKg: 78.5 }),
        row('2026-06-01', { weightKg: 82, waistCm: 92 }),
        row('2026-09-01', { weightKg: 80, waistCm: 90 }),
      ],
      '30D',
      '2026-09-26',
    );
    assert.equal(progress.rangeStart, '2026-08-28');
    assert.deepEqual(
      progress.entries.map((entry) => entry.date),
      ['2026-09-01', '2026-09-20'],
    );
    const weight = progress.summary.find((s) => s.field === 'weightKg')!;
    assert.deepEqual(
      [weight.latest, weight.change, weight.changeSince],
      [78.5, -1.5, '2026-09-01'],
    );
    // Measured once inside the range: a latest value, no change.
    const waist = progress.summary.find((s) => s.field === 'waistCm')!;
    assert.deepEqual([waist.latest, waist.change], [90, null]);
  });
});

describe('PROG-12 current weight follows the latest weighted entry', () => {
  it('writes the latest weight and leaves the account alone without one', async () => {
    const writes: number[] = [];
    const db = (latest: number | null) =>
      ({
        bodyMeasurement: {
          findFirst: async (args: { orderBy: { date: string } }) => {
            assert.equal(args.orderBy.date, 'desc');
            return latest === null ? null : { weightKg: latest };
          },
        },
        user: {
          update: async ({ data }: { data: { weight: number } }) => {
            writes.push(data.weight);
            return { weight: data.weight };
          },
        },
      }) as never;
    assert.equal(await syncCurrentWeight(db(79.2), 'u1'), 79.2);
    assert.equal(await syncCurrentWeight(db(null), 'u1'), null);
    assert.deepEqual(writes, [79.2]);
  });
});

type Owner = {
  id: string;
  timeZone: string | null;
  bodyProgressVisibility: 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE';
  moderationHiddenAt: Date | null;
};

function memberDb(
  owner: Owner,
  options: { follows?: boolean; blocked?: boolean } = {},
) {
  return {
    user: {
      findFirst: async () => owner,
      count: async () => (owner.moderationHiddenAt ? 1 : 0),
    },
    userBlock: { count: async () => (options.blocked ? 1 : 0) },
    userFollow: { count: async () => (options.follows ? 1 : 0) },
    bodyMeasurement: {
      findMany: async () => [row('2026-09-20', { weightKg: 78 })],
    },
  } as unknown as DatabaseService;
}

const owner = (
  visibility: Owner['bodyProgressVisibility'],
  hidden = false,
): Owner => ({
  id: 'owner',
  timeZone: 'UTC',
  bodyProgressVisibility: visibility,
  moderationHiddenAt: hidden ? new Date() : null,
});

describe('PROG-12 member reads of body progress', () => {
  const read = (
    db: DatabaseService,
    viewer: string | null,
  ): Promise<unknown> =>
    new BodyMeasurementsService(db).memberProgress(viewer, 'owner');

  it('answers the owner whatever the setting', async () => {
    await read(memberDb(owner('PRIVATE')), 'owner');
  });

  it('refuses everyone else while it is Only me', async () => {
    await assert.rejects(read(memberDb(owner('PRIVATE'), { follows: true }), 'v'), NotFoundException);
  });

  it('answers a follower, not a stranger, under Followers', async () => {
    await read(memberDb(owner('FOLLOWERS'), { follows: true }), 'v');
    await assert.rejects(read(memberDb(owner('FOLLOWERS')), 'v'), NotFoundException);
    await assert.rejects(read(memberDb(owner('FOLLOWERS')), null), NotFoundException);
  });

  it('answers a signed-out visitor under Everyone', async () => {
    await read(memberDb(owner('PUBLIC')), null);
  });

  it('refuses a blocked or hidden member even under Everyone', async () => {
    await assert.rejects(read(memberDb(owner('PUBLIC'), { blocked: true }), 'v'), NotFoundException);
    await assert.rejects(read(memberDb(owner('PUBLIC', true)), 'v'), NotFoundException);
    await assert.rejects(read(memberDb(owner('PUBLIC', true)), null), NotFoundException);
  });
});

describe('PROG-12 owner writes', () => {
  const service = () =>
    new BodyMeasurementsService({
      user: { findUnique: async () => ({ timeZone: 'UTC' }) },
    } as unknown as DatabaseService);

  it('refuses an empty entry, a value out of bounds and a bad date', async () => {
    await assert.rejects(service().upsert('u', '2026-01-01', {}), BadRequestException);
    await assert.rejects(
      service().upsert('u', '2026-01-01', { bodyFatPercent: 90 }),
      BadRequestException,
    );
    await assert.rejects(
      service().upsert('u', '2026-02-30', { weightKg: 80 }),
      BadRequestException,
    );
    await assert.rejects(
      service().upsert('u', '2999-01-01', { weightKg: 80 }),
      BadRequestException,
    );
  });
});

describe('PROG-12 a weight saved in Settings', () => {
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
    weight: 80,
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
    rankVisibility: 'PUBLIC' as const,
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
    const upserts: Array<{ date: string; weightKg: number }> = [];
    const db = {
      user: {
        findUnique: async () => ({ id: 'user-1', weight: 80, timeZone: 'UTC' }),
        update: async (args: { data: { weight?: number } }) => ({
          ...stored,
          weight: args.data.weight ?? stored.weight,
        }),
      },
      bodyMeasurement: {
        upsert: async (args: {
          where: { userId_date: { date: Date } };
          update: { weightKg: number };
        }) => {
          upserts.push({
            date: args.where.userId_date.date.toISOString().slice(0, 10),
            weightKg: args.update.weightKg,
          });
        },
        findFirst: async () => ({ weightKg: upserts[upserts.length - 1]?.weightKg ?? null }),
      },
      userBlock: { findMany: async () => [], count: async () => 0 },
    } as unknown as DatabaseService;
    return { service: new UsersService(db), upserts };
  }

  it("records a changed weight as the member's local date", async () => {
    const { service, upserts } = setup();
    const result = await service.updateProfile('owner@example.test', {
      weight: 78.6,
      localDate: '2026-09-20',
    });
    assert.deepEqual(upserts, [{ date: '2026-09-20', weightKg: 78.6 }]);
    assert.equal(result.weight, 78.6);
  });

  it('records nothing when the weight is unchanged or out of bounds', async () => {
    const { service, upserts } = setup();
    await service.updateProfile('owner@example.test', { weight: 80.004 });
    await service.updateProfile('owner@example.test', { weight: 5 });
    await service.updateProfile('owner@example.test', { name: 'Owner' });
    assert.deepEqual(upserts, []);
  });

  it('never dates it in the future', async () => {
    const { service, upserts } = setup();
    await service.updateProfile('owner@example.test', {
      weight: 79,
      localDate: '2999-01-01',
    });
    assert.notEqual(upserts[0]?.date, '2999-01-01');
  });
});
