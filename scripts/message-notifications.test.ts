import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  MESSAGE_PUSH_DELAY_SECONDS,
  NOTIFICATION_CATEGORIES,
  PUSH_PAYLOAD_KINDS,
} from '@sunsteel/contracts';

import { serverCopy } from '../src/i18n/server-copy';
import { maySchedulePush, messagePushStillDue } from '../src/messages/message-rules';
import {
  mapPreferences,
  suppressionFor,
} from '../src/notifications/push/notification-preferences.service';

const MIGRATION = readFileSync(
  'prisma/migrations/20261006200000_message_notifications/migration.sql',
  'utf8',
);
const SWEEP = readFileSync('src/notifications/push/scheduled-push.service.ts', 'utf8');
const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 10, minute));

describe('MSG-08 one push per conversation until read', () => {
  it('a conversation never pushed may push', () => {
    assert.equal(maySchedulePush(null, null), true);
    assert.equal(maySchedulePush(null, at(1)), true);
  });

  it('once pushed, nothing more until the reader has read past the push', () => {
    assert.equal(maySchedulePush(at(5), null), false);
    assert.equal(maySchedulePush(at(5), at(4)), false);
    assert.equal(maySchedulePush(at(5), at(6)), true);
  });
});

describe('MSG-08 a waiting push when it falls due', () => {
  const base = {
    cutoff: null as Date | null | undefined,
    newestFromThem: at(10) as Date | null,
    status: 'ACCEPTED' as const,
    hidden: false,
  };

  it('goes while the message is unread', () => {
    assert.equal(messagePushStillDue(base), true);
    assert.equal(messagePushStillDue({ ...base, cutoff: at(9) }), true);
  });

  it('is dropped once their newest message was read meanwhile', () => {
    assert.equal(messagePushStillDue({ ...base, cutoff: at(10) }), false);
    assert.equal(messagePushStillDue({ ...base, cutoff: at(11) }), false);
  });

  it('still goes for a message written after the reader caught up', () => {
    assert.equal(messagePushStillDue({ ...base, cutoff: at(8), newestFromThem: at(12) }), true);
  });

  it('is dropped when nothing of theirs is left to read', () => {
    assert.equal(messagePushStillDue({ ...base, newestFromThem: null }), false);
  });

  it('is dropped when the conversation is no longer theirs to read', () => {
    assert.equal(messagePushStillDue({ ...base, cutoff: undefined }), false);
    assert.equal(messagePushStillDue({ ...base, status: 'PENDING' }), false);
    assert.equal(messagePushStillDue({ ...base, status: null }), false);
    assert.equal(messagePushStillDue({ ...base, hidden: true }), false);
  });

  it('waits half a minute first', () => {
    assert.equal(MESSAGE_PUSH_DELAY_SECONDS, 30);
  });

  it('is compared with UTC, as it was written', () => {
    assert.match(SWEEP, /"sendAt" <= \(NOW\(\) AT TIME ZONE 'UTC'\)/);
  });

  it('counts as pushed only once a device took it, never when held back', () => {
    const send = SWEEP.lastIndexOf('await this.sender.sendToUser(row.userId, payload)');
    const held = SWEEP.indexOf('if (result.sent > 0)');
    const mark = SWEEP.indexOf('lastPushedAt: new Date()');
    assert.ok(send > 0 && held > send && mark > held);
    assert.equal(SWEEP.split('lastPushedAt: new Date()').length, 2);
  });
});

describe('MSG-08 the Messages category', () => {
  const row = {
    notifyRestAlert: true,
    notifyTrainingReminder: true,
    notifyStreakAtRisk: true,
    notifyPartnerSession: false,
    notifyPartnerAchievement: false,
    notifyMessages: true,
    quietHoursStartMinute: 22 * 60,
    quietHoursEndMinute: 7 * 60,
    reminderMinuteOfDay: null,
    timeZone: 'UTC',
  };

  it('is a push kind and a category of its own', () => {
    assert.ok((PUSH_PAYLOAD_KINDS as readonly string[]).includes('MESSAGE'));
    assert.ok((NOTIFICATION_CATEGORIES as readonly string[]).includes('MESSAGE'));
    assert.equal(mapPreferences(row).categories.MESSAGE, true);
  });

  it('can be switched in the preferences write, like every category', () => {
    const dto = readFileSync('src/notifications/push/dto/update-notification-preferences.dto.ts', 'utf8');
    for (const category of NOTIFICATION_CATEGORIES) {
      assert.ok(dto.includes(`  ${category}?: boolean;`), category);
    }
  });

  it('obeys its switch and the quiet window', () => {
    const minute = (date: Date) => date.getUTCHours() * 60 + date.getUTCMinutes();
    const noon = new Date(Date.UTC(2026, 9, 6, 12));
    const night = new Date(Date.UTC(2026, 9, 6, 23));
    assert.equal(suppressionFor('MESSAGE', mapPreferences(row), noon, minute), null);
    assert.equal(suppressionFor('MESSAGE', mapPreferences(row), night, minute), 'QUIET_HOURS');
    assert.equal(
      suppressionFor('MESSAGE', mapPreferences({ ...row, notifyMessages: false }), noon, minute),
      'CATEGORY_OFF',
    );
  });

  it('names the sender and never the text, in both languages', () => {
    assert.equal(serverCopy('en').messageTitle('Ana'), 'Ana sent you a message');
    assert.equal(serverCopy('es').messageTitle('Ana'), 'Ana te envió un mensaje');
    for (const locale of ['en', 'es']) {
      assert.doesNotMatch(serverCopy(locale).messageBody, /Ana/);
    }
  });
});

describe('MSG-08 migration', () => {
  it('starts every account with message pushes on', () => {
    assert.match(MIGRATION, /"notifyMessages" BOOLEAN NOT NULL DEFAULT true/);
  });

  it('is safe to run twice', () => {
    assert.ok(!/ADD COLUMN "/.test(MIGRATION));
  });
});
