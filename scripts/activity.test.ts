import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ACHIEVEMENT_DEFINITIONS,
  ACTIVITY_TYPE_SECTIONS,
  ACTIVITY_TYPES,
  PROFILE_VISIBILITY_VALUES,
  type ActivityType,
  type ProfilePrivacySettings,
  type ProfileVisibility,
  type UpdateActivitySharingRequest,
} from '@sunsteel/contracts';
import {
  activityLink,
  canViewActivity,
  decodeActivityCursor,
  encodeActivityCursor,
  entrySharing,
  eventActivityType,
  eventToEntry,
  isAfterCursor,
  narrowerAudience,
  pageActivity,
  planAllows,
  planAuthorActivity,
  seenDigest,
  sourceTake,
  type ActivityCursor,
  type AuthorSharingChoices,
} from '../src/activity/activity-rules';
import { ActivityService } from '../src/activity/activity.service';
import type { DatabaseService } from '../src/database/database.service';
import { sharedAtChange } from '../src/routines/routine-sharing.service';
import { blockPairWhere } from '../src/users/member-blocks';
import {
  canViewProfileSection,
  resolveProfileViewerAccess,
} from '../src/users/profile-privacy';

const OWNER = { isOwner: true, isFollower: false };
const FOLLOWER = { isOwner: false, isFollower: true };
const STRANGER = { isOwner: false, isFollower: false };
const VIEWERS = [OWNER, FOLLOWER, STRANGER];

const privacy = (
  overrides: Partial<ProfilePrivacySettings> = {},
): ProfilePrivacySettings => ({
  biography: 'PRIVATE',
  location: 'PRIVATE',
  trainingIdentity: 'PRIVATE',
  workoutHistory: 'PUBLIC',
  records: 'PUBLIC',
  routines: 'PUBLIC',
  achievements: 'PUBLIC',
  bodyMetrics: 'PRIVATE',
  ...overrides,
});

const choices = (
  defaults: Partial<Record<ActivityType, ProfileVisibility>> = {},
  overrides: [string, ActivityType, ProfileVisibility][] = [],
): AuthorSharingChoices => ({
  defaults,
  overrides: new Map(
    overrides.map(([key, type, audience]) => [key, { type, audience }]),
  ),
});

describe('SOC-04 the section is the upper bound', () => {
  it('is exactly the PROF-06 rule applied to the narrower of section and audience', () => {
    // Every section rule × every audience × every viewer. An entry may never
    // be seen by someone the section is hidden from, nor by someone its own
    // audience excludes, and the owner always sees their own.
    for (const type of ACTIVITY_TYPES) {
      for (const sectionRule of PROFILE_VISIBILITY_VALUES) {
        for (const audience of PROFILE_VISIBILITY_VALUES) {
          for (const viewer of VIEWERS) {
            const access = resolveProfileViewerAccess(
              privacy({ [ACTIVITY_TYPE_SECTIONS[type]]: sectionRule }),
              viewer,
            );
            assert.equal(
              canViewActivity(access, type, audience, viewer),
              canViewProfileSection(
                narrowerAudience(sectionRule, audience),
                viewer,
              ),
              `${type} section ${sectionRule} audience ${audience} ${JSON.stringify(viewer)}`,
            );
          }
        }
      }
    }
  });

  it('never turns a private records section into a public record entry', () => {
    const access = (viewer: typeof STRANGER) =>
      resolveProfileViewerAccess(privacy({ records: 'PRIVATE' }), viewer);
    const chosen = choices({ PERSONAL_RECORD: 'PUBLIC' }, [
      ['session:s:pr:e:v1', 'PERSONAL_RECORD', 'PUBLIC'],
    ]);
    for (const viewer of [FOLLOWER, STRANGER]) {
      const plan = planAuthorActivity(access(viewer), chosen, viewer);
      assert.equal(plan.visibleTypes.has('PERSONAL_RECORD'), false);
      assert.equal(
        planAllows(plan, 'PERSONAL_RECORD', 'session:s:pr:e:v1'),
        false,
        'an override cannot reach past the section either',
      );
    }
    // Only its owner still sees it.
    const own = planAuthorActivity(access(OWNER), chosen, OWNER);
    assert.equal(planAllows(own, 'PERSONAL_RECORD', 'session:s:pr:e:v1'), true);
  });

  it('shows nothing to anyone until its owner chooses, because visibility is never implicit', () => {
    for (const viewer of [FOLLOWER, STRANGER]) {
      const plan = planAuthorActivity(
        resolveProfileViewerAccess(privacy(), viewer),
        choices(),
        viewer,
      );
      assert.equal(plan.visibleTypes.size, 0);
      assert.equal(plan.include.size, 0);
    }
  });
});

describe('SOC-04 per-entry overrides', () => {
  const access = (viewer: typeof STRANGER) =>
    resolveProfileViewerAccess(privacy(), viewer);

  it('withdraws one entry from an audience its type would reach', () => {
    const chosen = choices({ SESSION_COMPLETED: 'FOLLOWERS' }, [
      ['session:a:completed:v1', 'SESSION_COMPLETED', 'PRIVATE'],
    ]);
    const plan = planAuthorActivity(access(FOLLOWER), chosen, FOLLOWER);
    assert.equal(planAllows(plan, 'SESSION_COMPLETED', 'session:b:completed:v1'), true);
    assert.equal(planAllows(plan, 'SESSION_COMPLETED', 'session:a:completed:v1'), false);
  });

  it('shares one entry wider than its type, within the section', () => {
    const chosen = choices({ SESSION_COMPLETED: 'PRIVATE' }, [
      ['session:a:completed:v1', 'SESSION_COMPLETED', 'PUBLIC'],
    ]);
    const plan = planAuthorActivity(access(STRANGER), chosen, STRANGER);
    assert.equal(planAllows(plan, 'SESSION_COMPLETED', 'session:a:completed:v1'), true);
    assert.equal(planAllows(plan, 'SESSION_COMPLETED', 'session:b:completed:v1'), false);
  });

  it('does not let an override of one type admit an entry of another', () => {
    const chosen = choices({}, [['k', 'SESSION_COMPLETED', 'PUBLIC']]);
    const plan = planAuthorActivity(access(STRANGER), chosen, STRANGER);
    assert.equal(planAllows(plan, 'PERSONAL_RECORD', 'k'), false);
  });
});

describe('SOC-04 what the owner is told', () => {
  it('names the section when it narrows the chosen audience', () => {
    const sharing = entrySharing({
      type: 'PERSONAL_RECORD',
      privacy: privacy({ records: 'FOLLOWERS' }),
      defaultAudience: 'PUBLIC',
      override: null,
    });
    assert.equal(sharing.section, 'records');
    assert.equal(sharing.effectiveAudience, 'FOLLOWERS');
    assert.equal(sharing.cappedBy, 'SECTION');
  });

  it('names the routine when its own visibility narrows further', () => {
    const shared = entrySharing({
      type: 'ROUTINE_SHARED',
      privacy: privacy(),
      defaultAudience: 'PUBLIC',
      override: null,
      routineVisibility: 'FOLLOWERS',
    });
    assert.equal(shared.effectiveAudience, 'FOLLOWERS');
    assert.equal(shared.cappedBy, 'ROUTINE');
    const unshared = entrySharing({
      type: 'ROUTINE_SHARED',
      privacy: privacy(),
      defaultAudience: 'PUBLIC',
      override: null,
      routineVisibility: 'PRIVATE',
    });
    assert.equal(unshared.effectiveAudience, 'PRIVATE');
    assert.equal(unshared.cappedBy, 'ROUTINE');
  });

  it('reports no cap when the choice is what took effect, and an override over the default', () => {
    const sharing = entrySharing({
      type: 'SESSION_COMPLETED',
      privacy: privacy(),
      defaultAudience: 'PUBLIC',
      override: 'FOLLOWERS',
    });
    assert.equal(sharing.effectiveAudience, 'FOLLOWERS');
    assert.equal(sharing.override, 'FOLLOWERS');
    assert.equal(sharing.cappedBy, null);
  });
});

describe('SOC-03 which events are activity', () => {
  const streakAchievement = ACHIEVEMENT_DEFINITIONS.find(
    (definition) => definition.category === 'STREAK_DAYS',
  )!;
  const sessionAchievement = ACHIEVEMENT_DEFINITIONS.find(
    (definition) => definition.category === 'SESSIONS',
  )!;

  it('never announces anything recognized from history', () => {
    assert.equal(
      eventActivityType({
        type: 'ACHIEVEMENT_UNLOCKED',
        payload: { ...sessionAchievement, backfilled: true },
      }),
      null,
    );
    assert.equal(
      eventActivityType({
        type: 'STREAK_MILESTONE',
        payload: { achievementId: streakAchievement.id, backfilled: true },
      }),
      null,
    );
  });

  it('reports a streak once, as the streak, not also as an achievement', () => {
    assert.equal(
      eventActivityType({
        type: 'ACHIEVEMENT_UNLOCKED',
        payload: { ...streakAchievement, backfilled: false },
      }),
      null,
    );
    assert.equal(
      eventActivityType({
        type: 'STREAK_MILESTONE',
        payload: { achievementId: streakAchievement.id, backfilled: false },
      }),
      'STREAK_MILESTONE',
    );
    assert.equal(
      eventActivityType({
        type: 'ACHIEVEMENT_UNLOCKED',
        payload: { ...sessionAchievement, backfilled: false },
      }),
      'ACHIEVEMENT_UNLOCKED',
    );
  });

  it('turns a record event into an entry that names the record', () => {
    const entry = eventToEntry(
      {
        id: 'e1',
        eventKey: 'session:s1:pr:x1:v1',
        userId: 'u1',
        sessionId: 's1',
        type: 'PERSONAL_RECORD',
        occurredAt: new Date('2026-09-19T10:00:00.000Z'),
        payload: {
          exerciseId: 'x1',
          exerciseName: 'Bench Press',
          setLogId: 'l1',
          weight: 100,
          reps: 5,
          estimated1rm: 116.7,
        },
      },
      {
        author: { username: 'lifter', name: 'Lee' },
        isOwner: false,
        recordIsCurrent: true,
      },
    );
    assert.ok(entry && entry.type === 'PERSONAL_RECORD');
    assert.deepEqual(entry.record, {
      exerciseId: 'x1',
      exerciseName: 'Bench Press',
      weightKg: 100,
      reps: 5,
      estimated1rmKg: 116.7,
    });
    assert.equal(entry.id, 'session:s1:pr:x1:v1');
    assert.equal(entry.groupKey, 'session:s1');
    assert.deepEqual(entry.link, { kind: 'MEMBER_RECORDS', username: 'lifter' });
  });
});

describe('SOC-03 links only where the viewer may open the record', () => {
  const other = { isOwner: false, username: 'lifter' };
  const own = { isOwner: true, username: 'me' };

  it('never links somebody else to a session or a load change, which no page shows them', () => {
    assert.equal(
      activityLink('SESSION_COMPLETED', { ...other, sessionId: 's', sessionExists: true }),
      null,
    );
    assert.equal(
      activityLink('PROGRESSION_CHANGED', { ...other, exerciseId: 'x' }),
      null,
    );
  });

  it('links a record only while it is still the best the profile shows', () => {
    assert.deepEqual(
      activityLink('PERSONAL_RECORD', { ...other, exerciseId: 'x', recordIsCurrent: true }),
      { kind: 'MEMBER_RECORDS', username: 'lifter' },
    );
    assert.equal(
      activityLink('PERSONAL_RECORD', { ...other, exerciseId: 'x', recordIsCurrent: false }),
      null,
    );
  });

  it('sends achievements, streaks and comebacks to the profile ledger, and a routine to its member page', () => {
    for (const type of ['ACHIEVEMENT_UNLOCKED', 'STREAK_MILESTONE', 'COMEBACK'] as const) {
      assert.deepEqual(activityLink(type, other), {
        kind: 'MEMBER_ACHIEVEMENTS',
        username: 'lifter',
      });
    }
    assert.deepEqual(activityLink('ROUTINE_SHARED', { ...other, routineId: 'r' }), {
      kind: 'MEMBER_ROUTINE',
      username: 'lifter',
      routineId: 'r',
    });
  });

  it('sends the owner to their own pages, and not to a session that no longer exists', () => {
    assert.deepEqual(
      activityLink('SESSION_COMPLETED', { ...own, sessionId: 's', sessionExists: true }),
      { kind: 'OWN_SESSION', sessionId: 's' },
    );
    assert.equal(
      activityLink('SESSION_COMPLETED', { ...own, sessionId: 's', sessionExists: false }),
      null,
    );
    assert.deepEqual(activityLink('PERSONAL_RECORD', { ...own, exerciseId: 'x' }), {
      kind: 'OWN_EXERCISE',
      exerciseId: 'x',
    });
    assert.deepEqual(activityLink('COMEBACK', own), { kind: 'OWN_ACHIEVEMENTS' });
    assert.deepEqual(activityLink('ROUTINE_SHARED', { ...own, routineId: 'r' }), {
      kind: 'OWN_ROUTINE',
      routineId: 'r',
    });
  });
});

describe('SOC-03 pagination across ties', () => {
  // The facts of one workout share its end time, so ties are the normal case.
  const at = (minute: number) =>
    new Date(Date.UTC(2026, 8, 19, 10, minute)).toISOString();
  const all = [
    { id: 'session:a:completed:v1', occurredAt: at(30) },
    { id: 'session:a:progression:1:v1', occurredAt: at(30) },
    { id: 'session:a:progression:2:v1', occurredAt: at(30) },
    { id: 'achievement:u:sessions:5:v1', occurredAt: at(30) },
    { id: 'routine:r1', occurredAt: at(20) },
    { id: 'session:b:completed:v1', occurredAt: at(10) },
    { id: 'session:b:pr:x:v1', occurredAt: at(10) },
  ];

  /** What a source query returns: at or before the cursor, newest first, `take` rows. */
  const source = (cursor: ActivityCursor | null, take: number) =>
    [...all]
      .filter((entry) => !cursor || Date.parse(entry.occurredAt) <= cursor.at.getTime())
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
      .slice(0, take);

  it('returns every entry exactly once, in order, whatever the page size', () => {
    for (const limit of [1, 2, 3, 5, 10]) {
      const seen: string[] = [];
      let cursor: ActivityCursor | null = null;
      for (let guard = 0; guard < 20; guard += 1) {
        const page = pageActivity(source(cursor, sourceTake(limit, cursor)), limit, cursor);
        seen.push(...page.entries.map((entry) => entry.id));
        if (!page.nextCursor) break;
        cursor = decodeActivityCursor(page.nextCursor);
      }
      assert.equal(seen.length, all.length, `limit ${limit}`);
      assert.deepEqual(new Set(seen), new Set(all.map((entry) => entry.id)));
      const times = seen.map((id) => Date.parse(all.find((entry) => entry.id === id)!.occurredAt));
      assert.deepEqual(times, [...times].sort((a, b) => b - a));
    }
  });

  it('refuses a cursor it did not write', () => {
    assert.throws(() => decodeActivityCursor('not-a-cursor'), BadRequestException);
    const tampered = Buffer.from(
      JSON.stringify({ at: 'yesterday', seen: [] }),
    ).toString('base64url');
    assert.throws(() => decodeActivityCursor(tampered), BadRequestException);
    const round = decodeActivityCursor(
      encodeActivityCursor({ at: new Date(at(30)), seen: [seenDigest('k')] }),
    );
    assert.ok(round && isAfterCursor({ id: 'other', occurredAt: at(30) }, round));
    assert.equal(isAfterCursor({ id: 'k', occurredAt: at(30) }, round), false);
  });
});

describe('SOC-03 when a routine counts as shared', () => {
  it('is the moment a private routine becomes visible to anyone', () => {
    assert.equal(sharedAtChange('PRIVATE', 'PUBLIC'), true);
    assert.equal(sharedAtChange('PRIVATE', 'FOLLOWERS'), true);
    assert.equal(sharedAtChange('FOLLOWERS', 'PUBLIC'), false);
    assert.equal(sharedAtChange('PUBLIC', 'PRIVATE'), false);
    assert.equal(sharedAtChange('PRIVATE', 'PRIVATE'), false);
  });
});

describe('ActivityService', () => {
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    username: id,
    name: id,
    lastName: null,
    avatarUrl: null,
    bioVisibility: 'PRIVATE',
    locationVisibility: 'PRIVATE',
    trainingIdentityVisibility: 'PRIVATE',
    historyVisibility: 'PUBLIC',
    recordsVisibility: 'PUBLIC',
    routinesVisibility: 'PUBLIC',
    achievementsVisibility: 'PUBLIC',
    bodyMetricsVisibility: 'PRIVATE',
    ...overrides,
  });

  const makeDb = (overrides: Record<string, unknown> = {}) => {
    const reads: string[] = [];
    const eventQueries: unknown[] = [];
    const track =
      <T>(name: string, value: T) =>
      async (args?: unknown) => {
        reads.push(name);
        if (name === 'trainingEvent.findMany') eventQueries.push(args);
        return value;
      };
    const db = {
      user: {
        findFirst: track('user.findFirst', row('them')),
        findUnique: track('user.findUnique', row('me')),
        findMany: track('user.findMany', [] as unknown[]),
      },
      // Stated explicitly: this account blocks nobody. A fixture that omitted
      // the block read would let a block pass by silence.
      userBlock: {
        count: track('userBlock.count', 0),
        findMany: track('userBlock.findMany', [] as unknown[]),
      },
      userFollow: {
        findUnique: track('userFollow.findUnique', null),
        findMany: track('userFollow.findMany', [] as unknown[]),
      },
      activitySharingDefault: {
        findMany: track('activitySharingDefault.findMany', [] as unknown[]),
        findUnique: track('activitySharingDefault.findUnique', null),
        upsert: track('activitySharingDefault.upsert', {}),
      },
      activityEntryOverride: {
        findMany: track('activityEntryOverride.findMany', [] as unknown[]),
        upsert: track('activityEntryOverride.upsert', {}),
        deleteMany: track('activityEntryOverride.deleteMany', {}),
      },
      trainingEvent: {
        findMany: track('trainingEvent.findMany', [] as unknown[]),
        findUnique: track('trainingEvent.findUnique', null),
      },
      routine: {
        findMany: track('routine.findMany', [] as unknown[]),
        findFirst: track('routine.findFirst', null),
      },
      workoutAnalyticsProjection: {
        findFirst: track('workoutAnalyticsProjection.findFirst', null),
      },
      workoutSession: { findMany: track('workoutSession.findMany', [] as unknown[]) },
      personalRecord: { findMany: track('personalRecord.findMany', [] as unknown[]) },
      $transaction: async (ops: unknown[]) => Promise.all(ops),
      ...overrides,
    } as unknown as DatabaseService;
    return { db, reads, eventQueries };
  };

  it("answers a member's activity with 404 across a block, before reading any of it", async () => {
    let where: unknown;
    const { db, reads } = makeDb({
      userBlock: {
        count: async (args: { where: unknown }) => {
          where = args.where;
          return 1;
        },
        findMany: async () => [],
      },
    });
    await assert.rejects(
      new ActivityService(db).member('me', 'them', {}),
      NotFoundException,
    );
    // Both directions: the pair, not only "I blocked them".
    assert.deepEqual(where, blockPairWhere('me', 'them'));
    assert.deepEqual(
      reads.filter((name) => !['user.findFirst'].includes(name)),
      [],
      'no activity, sharing or follow read happens before the refusal',
    );
  });

  it('leaves blocked members out of the feed, whichever side blocked', async () => {
    let authorQuery: unknown;
    const { db } = makeDb({
      userBlock: {
        count: async () => 0,
        findMany: async () => [
          { blockerId: 'blocked-by-me', blockedId: 'me' },
        ],
      },
      userFollow: {
        findUnique: async () => null,
        findMany: async () => [
          { followingId: 'friend' },
          { followingId: 'blocked-by-me' },
        ],
      },
      user: {
        findFirst: async () => null,
        findUnique: async () => null,
        findMany: async (args: unknown) => {
          authorQuery = args;
          return [];
        },
      },
    });
    const feed = await new ActivityService(db).feed('me', {});
    assert.deepEqual(
      (authorQuery as { where: { id: { in: string[] } } }).where.id.in,
      ['friend'],
    );
    assert.equal(feed.followedCount, 1);
    assert.equal(feed.followedTruncated, false);
  });

  it('previews an audience through the same read, as that audience', async () => {
    const defaults = [
      { userId: 'me', type: 'SESSION_COMPLETED', audience: 'FOLLOWERS' },
    ];
    const followers = makeDb({
      activitySharingDefault: { findMany: async () => defaults },
    });
    await new ActivityService(followers.db).preview('me', { audience: 'FOLLOWERS' });
    assert.equal(followers.eventQueries.length, 1, 'a follower is shown the sessions');

    const everyone = makeDb({
      activitySharingDefault: { findMany: async () => defaults },
    });
    const page = await new ActivityService(everyone.db).preview('me', {
      audience: 'PUBLIC',
    });
    assert.equal(everyone.eventQueries.length, 0, 'anyone else is shown nothing');
    assert.deepEqual(page.entries, []);
  });

  it('refuses an override for an entry the owner does not have', async () => {
    const someoneElses = makeDb({
      trainingEvent: {
        findMany: async () => [],
        findUnique: async () => ({
          userId: 'them',
          type: 'SESSION_COMPLETED',
          payload: {},
        }),
      },
    });
    await assert.rejects(
      new ActivityService(someoneElses.db).setEntryAudience('me', {
        entryId: 'session:x:completed:v1',
        audience: 'PUBLIC',
      }),
      NotFoundException,
    );
    const fromHistory = makeDb({
      trainingEvent: {
        findMany: async () => [],
        findUnique: async () => ({
          userId: 'me',
          type: 'ACHIEVEMENT_UNLOCKED',
          payload: { ...ACHIEVEMENT_DEFINITIONS[0], backfilled: true },
        }),
      },
    });
    await assert.rejects(
      new ActivityService(fromHistory.db).setEntryAudience('me', {
        entryId: 'achievement:me:sessions:1:v1',
        audience: 'PUBLIC',
      }),
      NotFoundException,
      'an entry that never renders cannot be shared',
    );
  });

  it('withdraws an entry and reports the audience that took effect', async () => {
    let written: unknown;
    const { db } = makeDb({
      trainingEvent: {
        findMany: async () => [],
        findUnique: async () => ({
          userId: 'me',
          type: 'PERSONAL_RECORD',
          payload: {},
        }),
      },
      activityEntryOverride: {
        findMany: async () => [],
        deleteMany: async () => ({}),
        upsert: async (args: unknown) => {
          written = args;
          return {};
        },
      },
    });
    const result = await new ActivityService(db).setEntryAudience('me', {
      entryId: 'session:s:pr:x:v1',
      audience: 'PRIVATE',
    });
    assert.equal(
      (written as { create: { type: string; audience: string } }).create.type,
      'PERSONAL_RECORD',
    );
    assert.equal(result.sharing.override, 'PRIVATE');
    assert.equal(result.sharing.effectiveAudience, 'PRIVATE');
  });

  it('names what it refused in a sharing update', async () => {
    // Deliberately invalid input, as a client could send it.
    const invalid = (defaults: Record<string, string>) =>
      ({ defaults }) as unknown as UpdateActivitySharingRequest;
    const { db } = makeDb();
    const service = new ActivityService(db);
    await assert.rejects(
      service.updateSharing('me', { defaults: {} }),
      BadRequestException,
    );
    await assert.rejects(
      service.updateSharing('me', invalid({ RANK_REACHED: 'PUBLIC' })),
      /Unknown activity type: RANK_REACHED/,
    );
    await assert.rejects(
      service.updateSharing('me', invalid({ SESSION_COMPLETED: 'EVERYONE' })),
      /Invalid audience for SESSION_COMPLETED/,
    );
  });

  it('starts every type at Only me', async () => {
    const { db } = makeDb();
    const settings = await new ActivityService(db).sharing('me');
    assert.deepEqual(
      Object.values(settings.defaults),
      ACTIVITY_TYPES.map(() => 'PRIVATE'),
    );
    assert.deepEqual(settings.sections, {
      workoutHistory: 'PUBLIC',
      records: 'PUBLIC',
      achievements: 'PUBLIC',
      routines: 'PUBLIC',
    });
  });
});
