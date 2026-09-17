import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseService } from '../src/database/database.service';
import { PushConfigService } from '../src/notifications/push/push-config.service';
import { PushSenderService } from '../src/notifications/push/push-sender.service';
import { PushSubscriptionsService } from '../src/notifications/push/push-subscriptions.service';
import { RestAlertService } from '../src/notifications/push/rest-alert.service';
import { ScheduledPushService } from '../src/notifications/push/scheduled-push.service';

const configured = { isConfigured: true, publicKey: 'BPublicKey' };
const unconfigured = { isConfigured: false, publicKey: null };
const asConfig = (value: unknown) => value as PushConfigService;
const asDb = (value: unknown) => value as DatabaseService;

const session = { id: 'session-1' };

const restAlertDb = (overrides: Record<string, unknown> = {}) => ({
  workoutSession: { findFirst: async () => session },
  pushSubscription: { count: async () => 1 },
  scheduledPush: {
    upsert: async () => undefined,
    deleteMany: async () => ({ count: 0 }),
  },
  ...overrides,
});

const scheduledStub = () => {
  const calls: { scheduled: unknown[]; cancelled: unknown[] } = {
    scheduled: [],
    cancelled: [],
  };
  const service = {
    schedule: async (
      userId: string,
      sessionId: string,
      sendAt: Date,
      payload: unknown,
    ) => {
      calls.scheduled.push({ userId, sessionId, sendAt, payload });
    },
    cancel: async (userId: string, sessionId: string) => {
      calls.cancelled.push({ userId, sessionId });
    },
  } as unknown as ScheduledPushService;
  return { service, calls };
};

const inSeconds = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toISOString();

test('a rest alert is refused, not faked, when push is unconfigured', async () => {
  const { service: scheduled, calls } = scheduledStub();
  const alerts = new RestAlertService(
    asDb(restAlertDb()),
    scheduled,
    asConfig(unconfigured),
  );

  const result = await alerts.schedule('user-1', 'session-1', {
    endsAt: inSeconds(90),
    exerciseName: 'Bench Press',
  });

  assert.deepEqual(result, { scheduledFor: null, reason: 'PUSH_UNAVAILABLE' });
  assert.equal(calls.scheduled.length, 0);
});

test('an account with no subscribed device is told so', async () => {
  const { service: scheduled, calls } = scheduledStub();
  const alerts = new RestAlertService(
    asDb(restAlertDb({ pushSubscription: { count: async () => 0 } })),
    scheduled,
    asConfig(configured),
  );

  const result = await alerts.schedule('user-1', 'session-1', {
    endsAt: inSeconds(90),
    exerciseName: 'Bench Press',
  });

  assert.deepEqual(result, { scheduledFor: null, reason: 'NO_SUBSCRIPTION' });
  assert.equal(calls.scheduled.length, 0);
});

test('rest ending sooner than the sweep cancels instead of promising', async () => {
  const { service: scheduled, calls } = scheduledStub();
  const alerts = new RestAlertService(
    asDb(restAlertDb()),
    scheduled,
    asConfig(configured),
  );

  const result = await alerts.schedule('user-1', 'session-1', {
    endsAt: inSeconds(2),
    exerciseName: 'Bench Press',
  });

  assert.deepEqual(result, { scheduledFor: null, reason: 'TOO_SOON' });
  assert.equal(calls.scheduled.length, 0);
  // A previous rest period's alert must not survive a set finished early.
  assert.deepEqual(calls.cancelled, [
    { userId: 'user-1', sessionId: 'session-1' },
  ]);
});

test('an absurd lead time is refused', async () => {
  const { service: scheduled } = scheduledStub();
  const alerts = new RestAlertService(
    asDb(restAlertDb()),
    scheduled,
    asConfig(configured),
  );

  const result = await alerts.schedule('user-1', 'session-1', {
    endsAt: inSeconds(7200),
    exerciseName: 'Bench Press',
  });

  assert.equal(result.reason, 'TOO_SOON');
  assert.equal(result.scheduledFor, null);
});

test('a scheduled alert names the lift and points at the session', async () => {
  const { service: scheduled, calls } = scheduledStub();
  const alerts = new RestAlertService(
    asDb(restAlertDb()),
    scheduled,
    asConfig(configured),
  );
  const endsAt = inSeconds(120);

  const result = await alerts.schedule('user-1', 'session-1', {
    endsAt,
    exerciseName: '  Barbell Row  ',
  });

  assert.equal(result.reason, null);
  assert.equal(result.scheduledFor, new Date(endsAt).toISOString());
  assert.equal(calls.scheduled.length, 1);
  const call = calls.scheduled[0] as { payload: Record<string, string> };
  assert.deepEqual(call.payload, {
    kind: 'REST_ALERT',
    title: 'Rest is over',
    body: 'Barbell Row is up next.',
    sessionId: 'session-1',
    url: '/workouts/sessions/session-1',
    tag: 'rest-session-1',
  });
  // No countdown is promised anywhere: the API has no chronometer field.
  assert.ok(!/\d+\s*(s|sec|min)/i.test(call.payload.body));
});

test('a session the caller does not own is not found', async () => {
  const { service: scheduled } = scheduledStub();
  const alerts = new RestAlertService(
    asDb(restAlertDb({ workoutSession: { findFirst: async () => null } })),
    scheduled,
    asConfig(configured),
  );

  await assert.rejects(
    alerts.schedule('intruder', 'session-1', {
      endsAt: inSeconds(90),
      exerciseName: 'Bench Press',
    }),
    /not found/i,
  );
});

test('registering the same endpoint twice keeps one device', async () => {
  const upserts: unknown[] = [];
  const rows = [
    {
      id: 'sub-1',
      endpoint: 'https://push.example/abc',
      deviceLabel: 'Pixel',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
      lastSeenAt: new Date('2026-09-17T10:00:00.000Z'),
    },
  ];
  const service = new PushSubscriptionsService(
    asDb({
      pushSubscription: {
        upsert: async (args: unknown) => {
          upserts.push(args);
        },
        findMany: async (args: { skip?: number }) =>
          args.skip === undefined ? rows : [],
        deleteMany: async () => ({ count: 0 }),
      },
    }),
    asConfig(configured),
  );

  const result = await service.register('user-1', {
    endpoint: 'https://push.example/abc',
    expirationTime: null,
    keys: { p256dh: 'key', auth: 'auth' },
    deviceLabel: 'Pixel',
  });

  assert.equal(upserts.length, 1);
  assert.equal(result.subscriptions.length, 1);
  assert.equal(result.subscriptions[0].isCurrentDevice, true);
  assert.equal(result.vapidPublicKey, 'BPublicKey');
});

test('a device list never leaks the endpoint that can push to it', async () => {
  const service = new PushSubscriptionsService(
    asDb({
      pushSubscription: {
        findMany: async () => [
          {
            id: 'sub-1',
            endpoint: 'https://push.example/secret-capability',
            deviceLabel: 'Pixel',
            createdAt: new Date('2026-09-01T10:00:00.000Z'),
            lastSeenAt: new Date('2026-09-17T10:00:00.000Z'),
          },
        ],
      },
    }),
    asConfig(configured),
  );

  const result = await service.list('user-1');

  assert.ok(!JSON.stringify(result).includes('secret-capability'));
  assert.equal(result.subscriptions[0].isCurrentDevice, false);
});

test('push is reported unavailable when the server holds no key', async () => {
  const service = new PushSubscriptionsService(
    asDb({ pushSubscription: { findMany: async () => [] } }),
    asConfig(unconfigured),
  );

  assert.equal((await service.list('user-1')).vapidPublicKey, null);
});

test('a gone endpoint is retired and a flaky one is kept', async () => {
  const deleted: string[][] = [];
  const subscriptions = [
    { id: 'gone', endpoint: 'https://push.example/gone', p256dh: 'k', auth: 'a' },
    {
      id: 'flaky',
      endpoint: 'https://push.example/flaky',
      p256dh: 'k',
      auth: 'a',
    },
    { id: 'ok', endpoint: 'https://push.example/ok', p256dh: 'k', auth: 'a' },
  ];

  class StubSender extends PushSenderService {
    protected override deliver(subscription: {
      endpoint: string;
    }): Promise<unknown> {
      if (subscription.endpoint.endsWith('gone')) {
        return Promise.reject(
          Object.assign(new Error('gone'), { statusCode: 410 }),
        );
      }
      if (subscription.endpoint.endsWith('flaky')) {
        return Promise.reject(
          Object.assign(new Error('rate limited'), { statusCode: 429 }),
        );
      }
      return Promise.resolve(undefined);
    }
  }

  const sender = new StubSender(
    asDb({
      pushSubscription: {
        findMany: async () => subscriptions,
        deleteMany: async (args: { where: { id: { in: string[] } } }) => {
          deleted.push(args.where.id.in);
          return { count: args.where.id.in.length };
        },
      },
    }),
    asConfig(configured),
  );

  const result = await sender.sendToUser('user-1', {
    kind: 'REST_ALERT',
    title: 'Rest is over',
    body: 'Bench Press is up next.',
    sessionId: 'session-1',
    url: '/workouts/sessions/session-1',
    tag: 'rest-session-1',
  });

  assert.deepEqual(result, { sent: 1, retired: 1 });
  assert.deepEqual(deleted, [['gone']]);
});

test('nothing is sent when the server holds no VAPID key', async () => {
  let queried = false;
  const sender = new PushSenderService(
    asDb({
      pushSubscription: {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
    }),
    asConfig(unconfigured),
  );

  const result = await sender.sendToUser('user-1', {
    kind: 'REST_ALERT',
    title: 'Rest is over',
    body: 'Bench Press is up next.',
    sessionId: 'session-1',
    url: '/workouts/sessions/session-1',
    tag: 'rest-session-1',
  });

  assert.deepEqual(result, { sent: 0, retired: 0 });
  assert.equal(queried, false);
});
