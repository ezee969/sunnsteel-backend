import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  parseRealtimeEvent,
  REALTIME_MAX_STREAM_MS,
  REALTIME_MAX_STREAMS_PER_MEMBER,
} from '@sunsteel/contracts';

import { NOTIFICATION_EVENT_TYPES } from '../src/notifications/notification-sources';
import {
  bearerExpirySeconds,
  parseRealtimeSignal,
  RealtimeHub,
  type RealtimeStream,
  sseFrame,
  streamLifetimeMs,
} from '../src/realtime/realtime-rules';

const MIGRATION = readFileSync(
  'prisma/migrations/20261005100000_realtime_signals/migration.sql',
  'utf8',
);

function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `Bearer ${part({ alg: 'ES256' })}.${part(claims)}.signature`;
}

function stream(id: number, userId: string) {
  const sent: string[] = [];
  let closed = false;
  const value: RealtimeStream = {
    id,
    userId,
    send: (frame) => sent.push(frame),
    close: () => {
      closed = true;
    },
  };
  return { value, sent, isClosed: () => closed };
}

describe('MSG-06 realtime signals', () => {
  it('reads a trigger payload and refuses anything else', () => {
    assert.deepEqual(parseRealtimeSignal('{"u":"member-1","t":"notifications"}'), {
      userId: 'member-1',
      topic: 'notifications',
    });
    assert.equal(parseRealtimeSignal(undefined), null);
    assert.equal(parseRealtimeSignal('not json'), null);
    assert.equal(parseRealtimeSignal('{"u":null,"t":"notifications"}'), null);
    assert.equal(parseRealtimeSignal('{"u":"","t":"notifications"}'), null);
    assert.equal(parseRealtimeSignal('{"u":"member-1","t":"messages"}'), null);
  });

  it('writes an event the client parses back', () => {
    const frame = sseFrame({ type: 'changed', topic: 'notifications' });
    assert.match(frame, /^data: .+\n\n$/);
    assert.deepEqual(parseRealtimeEvent(frame.slice('data: '.length).trim()), {
      type: 'changed',
      topic: 'notifications',
    });
    assert.deepEqual(parseRealtimeEvent('{"type":"ready","topics":["notifications","x"]}'), {
      type: 'ready',
      topics: ['notifications'],
    });
    assert.equal(parseRealtimeEvent('{"type":"changed","topic":"x"}'), null);
  });

  it('the trigger announces every training event the gatherer reads, and the other sources', () => {
    for (const type of NOTIFICATION_EVENT_TYPES) {
      assert.ok(MIGRATION.includes(`'${type}'`), type);
    }
    for (const table of ['"Follow"', '"ActivityComment"', '"TrainingEvent"', '"Notification"']) {
      assert.ok(MIGRATION.includes(`ON ${table}`), table);
    }
    assert.ok(MIGRATION.includes('CREATE OR REPLACE FUNCTION'));
    assert.ok(!/CREATE TRIGGER/.test(MIGRATION), 'every trigger is create-or-replace');
  });
});

describe('MSG-06 stream lifetime', () => {
  it('reads the expiry of the accepted bearer token', () => {
    assert.equal(bearerExpirySeconds(token({ exp: 1_800_000_000 })), 1_800_000_000);
    assert.equal(bearerExpirySeconds(token({})), null);
    assert.equal(bearerExpirySeconds(undefined), null);
    assert.equal(bearerExpirySeconds('Basic abc'), null);
    assert.equal(bearerExpirySeconds('Bearer not-a-token'), null);
  });

  it('ends at the token expiry or the request limit, whichever is first', () => {
    const now = 1_800_000_000_000;
    assert.equal(streamLifetimeMs(now, now / 1000 + 60), 60_000);
    assert.equal(streamLifetimeMs(now, now / 1000 + 3_600), REALTIME_MAX_STREAM_MS);
    assert.equal(streamLifetimeMs(now, null), REALTIME_MAX_STREAM_MS);
    assert.equal(streamLifetimeMs(now, now / 1000 - 5), 0);
  });
});

describe('MSG-06 realtime hub', () => {
  it('sends a member only their own streams', () => {
    const hub = new RealtimeHub();
    const mine = stream(1, 'a');
    const theirs = stream(2, 'b');
    hub.add(mine.value);
    hub.add(theirs.value);
    assert.equal(hub.sendTo('a', 'x'), 1);
    assert.deepEqual(mine.sent, ['x']);
    assert.deepEqual(theirs.sent, []);
    assert.equal(hub.sendTo('nobody', 'x'), 0);
  });

  it('closes the oldest stream past the per-member limit', () => {
    const hub = new RealtimeHub();
    const streams = Array.from({ length: REALTIME_MAX_STREAMS_PER_MEMBER + 1 }, (_, i) =>
      stream(i + 1, 'a'),
    );
    for (const open of streams) hub.add(open.value);
    assert.equal(streams[0].isClosed(), true);
    assert.ok(streams.slice(1).every((open) => !open.isClosed()));
    assert.equal(hub.size, REALTIME_MAX_STREAMS_PER_MEMBER);
  });

  it('forgets a released stream and sends to everyone on a resync', () => {
    const hub = new RealtimeHub();
    const first = stream(1, 'a');
    const second = stream(2, 'b');
    hub.add(first.value);
    hub.add(second.value);
    hub.remove(first.value);
    hub.remove(first.value);
    hub.sendToAll('ready');
    assert.deepEqual(first.sent, []);
    assert.deepEqual(second.sent, ['ready']);
    hub.closeAll();
    assert.equal(second.isClosed(), true);
    assert.equal(hub.size, 0);
  });
});
