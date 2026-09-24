import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseService } from '../src/database/database.service';
import {
  mapPreferences,
  NotificationPreferencesService,
} from '../src/notifications/push/notification-preferences.service';
import { PushConfigService } from '../src/notifications/push/push-config.service';
import {
  partnerActivityPushPayload,
  partnerAlertIsVisible,
  partnerAlertPayload,
  partnerAlertSelection,
  type PartnerAlertEvent,
} from '../src/notifications/partner-activity-alerts';

const occurredAt = new Date('2026-09-24T10:00:00.000Z');
const event = (
  type: string,
  payload: Record<string, unknown> = {},
): PartnerAlertEvent => ({
  eventKey: `${type}:key`,
  userId: 'partner',
  sessionId: type === 'SESSION_COMPLETED' ? 'session-1' : null,
  type,
  occurredAt,
  payload,
});

test('only a completed session and a live non-streak achievement are selected', () => {
  assert.equal(
    partnerAlertSelection(event('SESSION_COMPLETED'))?.kind,
    'TRAINING_PARTNER_SESSION',
  );
  assert.equal(
    partnerAlertSelection(
      event('ACHIEVEMENT_UNLOCKED', {
        id: 'sessions-10',
        category: 'SESSIONS',
        backfilled: false,
      }),
    )?.kind,
    'TRAINING_PARTNER_ACHIEVEMENT',
  );
  assert.equal(partnerAlertSelection(event('PERSONAL_RECORD')), null);
  assert.equal(
    partnerAlertSelection(
      event('ACHIEVEMENT_UNLOCKED', {
        id: 'sessions-10',
        category: 'SESSIONS',
        backfilled: true,
      }),
    ),
    null,
  );
  assert.equal(
    partnerAlertSelection(
      event('ACHIEVEMENT_UNLOCKED', {
        id: 'streak-7',
        category: 'STREAK_DAYS',
        backfilled: false,
      }),
    ),
    null,
  );
});

test('visibility needs both opt-in time and the current activity plan', () => {
  const session = event('SESSION_COMPLETED');
  const visiblePlan = {
    visibleTypes: new Set(['SESSION_COMPLETED'] as const),
    include: new Map(),
    exclude: new Set<string>(),
  };
  assert.equal(
    partnerAlertIsVisible({
      event: session,
      plan: visiblePlan,
      enabledAt: new Date('2026-09-24T09:59:00.000Z'),
    }),
    true,
  );
  assert.equal(
    partnerAlertIsVisible({
      event: session,
      plan: visiblePlan,
      enabledAt: new Date('2026-09-24T10:01:00.000Z'),
    }),
    false,
  );
  assert.equal(
    partnerAlertIsVisible({
      event: session,
      plan: { ...visiblePlan, exclude: new Set([session.eventKey]) },
      enabledAt: new Date('2026-09-24T09:59:00.000Z'),
    }),
    false,
  );
});

test('session and achievement payloads stay bounded to the selected fact', () => {
  assert.deepEqual(
    partnerAlertPayload(event('SESSION_COMPLETED'), {
      id: 'session-1',
      routineName: 'Upper / Lower',
      dayName: 'Upper',
    }),
    {
      entryId: 'SESSION_COMPLETED:key',
      routineName: 'Upper / Lower',
      dayName: 'Upper',
    },
  );
  assert.deepEqual(
    partnerAlertPayload(
      event('ACHIEVEMENT_UNLOCKED', {
        id: 'sessions-10',
        title: 'Ten sessions',
        category: 'SESSIONS',
        backfilled: false,
      }),
      null,
    ),
    {
      entryId: 'ACHIEVEMENT_UNLOCKED:key',
      achievementId: 'sessions-10',
      title: 'Ten sessions',
    },
  );
});

test('push copy points to the partner and contains no inferred advice', () => {
  const payload = partnerActivityPushPayload({
    kind: 'TRAINING_PARTNER_SESSION',
    sourceKey: 'partner:session-1',
    payload: { routineName: 'Upper / Lower', dayName: 'Upper' },
    actor: {
      username: 'marta',
      name: 'Marta',
      lastName: 'Stone',
    },
  });
  assert.deepEqual(payload, {
    kind: 'TRAINING_PARTNER_SESSION',
    title: 'Marta Stone completed a workout',
    body: 'Upper / Lower · Upper',
    url: '/profile/marta',
    tag: 'partner-session-partner:session-1',
  });
  assert.doesNotMatch(JSON.stringify(payload), /should|must|train now/i);
});

test('notification preferences expose both partner categories as opt-ins', () => {
  const preferences = mapPreferences({
    notifyRestAlert: true,
    notifyTrainingReminder: true,
    notifyStreakAtRisk: true,
    notifyPartnerSession: false,
    notifyPartnerAchievement: true,
    quietHoursStartMinute: null,
    quietHoursEndMinute: null,
    reminderMinuteOfDay: null,
    timeZone: 'Europe/Berlin',
  });
  assert.equal(preferences.categories.TRAINING_PARTNER_SESSION, false);
  assert.equal(preferences.categories.TRAINING_PARTNER_ACHIEVEMENT, true);
});

test('partner opt-in starts at the change and opt-out clears delivered rows', async () => {
  const now = new Date('2026-09-24T10:00:00.000Z');
  const state = {
    notifyRestAlert: true,
    notifyTrainingReminder: true,
    notifyStreakAtRisk: true,
    notifyPartnerSession: false,
    notifyPartnerAchievement: false,
    partnerSessionAlertsEnabledAt: null as Date | null,
    partnerAchievementAlertsEnabledAt: null as Date | null,
    quietHoursStartMinute: null,
    quietHoursEndMinute: null,
    reminderMinuteOfDay: null,
    timeZone: 'Europe/Berlin',
  };
  const deletedKinds: string[][] = [];
  const db = {
    user: {
      findUniqueOrThrow: async () => ({ ...state }),
      update: async ({ data }: { data: Partial<typeof state> }) => {
        Object.assign(state, data);
        return { ...state };
      },
    },
    pushSubscription: { count: async () => 0 },
    scheduledPush: { deleteMany: async () => ({ count: 0 }) },
    notification: {
      deleteMany: async ({ where }: { where: { kind: { in: string[] } } }) => {
        deletedKinds.push(where.kind.in);
        return { count: 1 };
      },
    },
  } as unknown as DatabaseService;
  const config = { isConfigured: false } as PushConfigService;
  const service = new NotificationPreferencesService(db, config);

  await service.update(
    'owner',
    { categories: { TRAINING_PARTNER_SESSION: true } },
    now,
  );
  assert.equal(state.notifyPartnerSession, true);
  assert.equal(state.partnerSessionAlertsEnabledAt, now);

  await service.update('owner', {
    categories: { TRAINING_PARTNER_SESSION: false },
  });
  assert.equal(state.notifyPartnerSession, false);
  assert.equal(state.partnerSessionAlertsEnabledAt, null);
  assert.deepEqual(deletedKinds, [['TRAINING_PARTNER_SESSION']]);
});
