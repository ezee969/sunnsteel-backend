import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DatabaseService } from '../src/database/database.service';
import { UpdateOnboardingDto } from '../src/users/dto/update-onboarding.dto';
import { nextOnboarding } from '../src/users/onboarding';
import { UsersService } from '../src/users/users.service';

const now = new Date('2026-10-04T12:00:00.000Z');
const fresh = {
  onboardingCompletedVersion: 0,
  onboardingStepsDone: [] as string[],
  onboardingOfferedAt: null as Date | null,
};

describe('ONBOARD-01 onboarding progress', () => {
  it('adds steps to the stored ones, once each, so two devices never undo each other', () => {
    const first = nextOnboarding(fresh, { stepsDone: ['units', 'goals'] }, now);
    const second = nextOnboarding(first, { stepsDone: ['goals', 'days'] }, now);
    assert.deepEqual(second.onboardingStepsDone, ['units', 'goals', 'days']);
    assert.equal(second.onboardingCompletedVersion, 0);
  });

  it('a completed version only rises, and starts the next run empty', () => {
    const done = nextOnboarding(
      { ...fresh, onboardingStepsDone: ['units'] },
      { completedVersion: 1 },
      now,
    );
    assert.equal(done.onboardingCompletedVersion, 1);
    assert.deepEqual(done.onboardingStepsDone, []);
    const lower = nextOnboarding(
      { ...done, onboardingStepsDone: ['days'] },
      { completedVersion: 0 },
      now,
    );
    assert.equal(lower.onboardingCompletedVersion, 1);
    assert.deepEqual(lower.onboardingStepsDone, ['days']);
  });

  it('records the first opening once and keeps it', () => {
    const offered = nextOnboarding(fresh, { offered: true }, now);
    assert.equal(offered.onboardingOfferedAt, now);
    const later = nextOnboarding(
      offered,
      { offered: true },
      new Date('2026-10-05T00:00:00.000Z'),
    );
    assert.equal(later.onboardingOfferedAt, now);
    assert.equal(nextOnboarding(fresh, {}, now).onboardingOfferedAt, null);
  });

  it('refuses a malformed body', async () => {
    const problems = async (body: unknown) =>
      (await validate(plainToInstance(UpdateOnboardingDto, body))).length;
    assert.equal(await problems({ stepsDone: ['units', 'weekly-target'] }), 0);
    assert.equal(await problems({ completedVersion: 1, offered: true }), 0);
    assert.ok(await problems({ stepsDone: ['Units'] }));
    assert.ok(await problems({ stepsDone: ['a'.repeat(41)] }));
    assert.ok(
      await problems({ stepsDone: Array.from({ length: 31 }, (_, i) => `s${i}`) }),
    );
    assert.ok(await problems({ completedVersion: 1.5 }));
    assert.ok(await problems({ completedVersion: -1 }));
    assert.ok(await problems({ offered: false }));
  });

  it('answers the profile with the stored progress', async () => {
    let written: unknown;
    const stored = {
      onboardingCompletedVersion: 0,
      onboardingStepsDone: ['units'],
      onboardingOfferedAt: null,
    };
    const tx = {
      user: {
        findUniqueOrThrow: async () => stored,
        update: async (args: { data: unknown }) => {
          written = args.data;
          return { ...(args.data as object), id: 'user-1' };
        },
      },
    };
    const db = {
      $transaction: async (run: (client: typeof tx) => unknown) => run(tx),
    } as unknown as DatabaseService;
    const service = new UsersService(db);
    const mapped: unknown[] = [];
    (service as unknown as { mapUserProfile: (user: unknown) => unknown }).mapUserProfile =
      (user: unknown) => {
        mapped.push(user);
        return user;
      };
    await service.updateOnboarding('owner@example.test', {
      stepsDone: ['goals'],
      offered: true,
    });
    assert.deepEqual(
      (written as { onboardingStepsDone: string[] }).onboardingStepsDone,
      ['units', 'goals'],
    );
    assert.ok((written as { onboardingOfferedAt: Date }).onboardingOfferedAt instanceof Date);
    assert.equal(mapped.length, 1);
  });
});
