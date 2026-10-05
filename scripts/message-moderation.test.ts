import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  MESSAGE_REPORT_CONTEXT_BEFORE,
  MODERATION_ACTION_KINDS,
  REPORT_STATUSES,
  REPORT_SUBJECT_KINDS,
  type ReportStatus,
} from '@sunsteel/contracts';

import {
  captureMessages,
  messageFor,
  readCapturedMessages,
  reportRefusal,
  type StoredMessage,
} from '../src/messages/message-moderation';
import { maySendTo } from '../src/messages/message-rules';
import { resolvesReport, statusAfter } from '../src/moderation/moderation-rules';

const MIGRATION = readFileSync(
  'prisma/migrations/20261006100000_message_moderation/migration.sql',
  'utf8',
);
const REPORTER = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';

function message(
  id: string,
  minute: number,
  overrides: Partial<StoredMessage> = {},
): StoredMessage {
  return {
    id,
    senderId: AUTHOR,
    body: `text ${id}`,
    deletedAt: null,
    moderationHiddenAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 6, 10, minute)),
    ...overrides,
  };
}

describe('MSG-09 what each participant reads', () => {
  const hidden = message('m1', 0, { moderationHiddenAt: new Date() });

  it('a hidden message loses its text for the other participant only', () => {
    const theirs = messageFor(hidden, REPORTER);
    assert.equal(theirs.body, null);
    assert.equal(theirs.hiddenByModeration, true);
    assert.equal(theirs.deleted, false);
  });

  it('its author still reads it and is told it is hidden', () => {
    const mine = messageFor(hidden, AUTHOR);
    assert.equal(mine.body, 'text m1');
    assert.equal(mine.sentByMe, true);
    assert.equal(mine.hiddenByModeration, true);
  });

  it('a deleted message reads as deleted for both, hidden or not', () => {
    const gone = { ...hidden, body: null, deletedAt: new Date() };
    for (const viewer of [REPORTER, AUTHOR]) {
      const seen = messageFor(gone, viewer);
      assert.equal(seen.deleted, true);
      assert.equal(seen.hiddenByModeration, false);
      assert.equal(seen.body, null);
    }
  });

  it('an untouched message is unchanged by any of it', () => {
    const seen = messageFor(message('m2', 1), REPORTER);
    assert.deepEqual(
      { body: seen.body, deleted: seen.deleted, hidden: seen.hiddenByModeration },
      { body: 'text m2', deleted: false, hidden: false },
    );
  });
});

describe('MSG-09 who may report a message', () => {
  it('never your own', () => {
    assert.equal(
      reportRefusal(message('m', 0, { senderId: REPORTER }), REPORTER),
      'OWN',
    );
  });

  it('not one you can no longer read: deleted, or already removed', () => {
    assert.equal(
      reportRefusal(message('m', 0, { body: null, deletedAt: new Date() }), REPORTER),
      'UNREADABLE',
    );
    assert.equal(
      reportRefusal(message('m', 0, { moderationHiddenAt: new Date() }), REPORTER),
      'UNREADABLE',
    );
  });

  it('the other member\'s message you can read', () => {
    assert.equal(reportRefusal(message('m', 0), REPORTER), null);
  });
});

describe('MSG-09 the capture', () => {
  const history = Array.from({ length: 9 }, (_, index) =>
    message(`m${index}`, index, {
      senderId: index % 2 === 0 ? AUTHOR : REPORTER,
    }),
  );

  it('is the reported message and at most five before it, oldest first', () => {
    const shuffled = [...history].reverse();
    const captured = captureMessages(shuffled, 'm8', REPORTER);
    assert.equal(MESSAGE_REPORT_CONTEXT_BEFORE, 5);
    assert.deepEqual(
      captured.map((item) => item.id),
      ['m3', 'm4', 'm5', 'm6', 'm7', 'm8'],
    );
    assert.deepEqual(
      captured.map((item) => item.isReported),
      [false, false, false, false, false, true],
    );
  });

  it('holds fewer when the conversation has fewer before it', () => {
    const captured = captureMessages(history, 'm2', REPORTER);
    assert.deepEqual(captured.map((item) => item.id), ['m0', 'm1', 'm2']);
  });

  it('says who wrote each one, from the reporter\'s side', () => {
    const captured = captureMessages(history, 'm2', REPORTER);
    assert.deepEqual(
      captured.map((item) => item.fromReporter),
      [false, true, false],
    );
  });

  it('keeps each message as the reporter could read it then', () => {
    const rows = [
      message('a', 0, { body: null, deletedAt: new Date() }),
      message('b', 1, { moderationHiddenAt: new Date() }),
      message('c', 2, { senderId: REPORTER, moderationHiddenAt: new Date() }),
      message('d', 3),
    ];
    const captured = captureMessages(rows, 'd', REPORTER);
    assert.deepEqual(
      captured.map((item) => [item.id, item.body, item.deleted]),
      [
        ['a', null, true],
        ['b', null, false],
        ['c', 'text c', false],
        ['d', 'text d', false],
      ],
    );
  });

  it('orders messages of the same instant by id, as the thread does', () => {
    const rows = [message('b', 0), message('a', 0), message('c', 0)];
    assert.deepEqual(
      captureMessages(rows, 'c', REPORTER).map((item) => item.id),
      ['a', 'b', 'c'],
    );
  });

  it('is empty when the reported message is not among the rows', () => {
    assert.deepEqual(captureMessages(history, 'nope', REPORTER), []);
  });

  it('reads back only what it stored', () => {
    const captured = captureMessages(history, 'm1', REPORTER);
    const stored = JSON.parse(JSON.stringify(captured)) as unknown;
    assert.deepEqual(readCapturedMessages(stored), captured);
    assert.deepEqual(readCapturedMessages(null), []);
    assert.deepEqual(readCapturedMessages([{ id: 1 }, 'x', ...captured]), captured);
  });
});

describe('MSG-09 a restricted member', () => {
  const base = {
    permission: 'FOLLOWED' as const,
    recipientFollowsSender: true,
    hasConversation: true,
    senderHidden: false,
    senderRestricted: true,
  };

  it('starts nothing and sends nothing, not even into a conversation', () => {
    assert.equal(maySendTo(base), false);
    assert.equal(maySendTo({ ...base, hasConversation: false }), false);
  });

  it('is back to the ordinary rule once lifted', () => {
    assert.equal(maySendTo({ ...base, senderRestricted: false }), true);
  });
});

describe('MSG-09 review state', () => {
  const STATUSES = REPORT_STATUSES as readonly ReportStatus[];

  it('reports a message and records the two new powers', () => {
    assert.ok((REPORT_SUBJECT_KINDS as readonly string[]).includes('MESSAGE'));
    for (const kind of ['RESTRICT_MESSAGING', 'LIFT_MESSAGING_RESTRICTION']) {
      assert.ok((MODERATION_ACTION_KINDS as readonly string[]).includes(kind));
    }
  });

  it('a restriction closes an open report as actioned and leaves others alone', () => {
    assert.equal(statusAfter('RESTRICT_MESSAGING', 'OPEN'), 'ACTIONED');
    assert.equal(statusAfter('RESTRICT_MESSAGING', 'DISMISSED'), 'DISMISSED');
    assert.equal(statusAfter('RESTRICT_MESSAGING', 'ACTIONED'), 'ACTIONED');
  });

  it('lifting one never reopens a report', () => {
    for (const status of STATUSES) {
      assert.equal(statusAfter('LIFT_MESSAGING_RESTRICTION', status), status);
    }
  });

  it('neither needs the report to be open', () => {
    assert.equal(resolvesReport('RESTRICT_MESSAGING'), false);
    assert.equal(resolvesReport('LIFT_MESSAGING_RESTRICTION'), false);
  });
});

describe('MSG-09 migration', () => {
  it('announces a hide, a restore and a restriction to the realtime stream', () => {
    assert.match(MIGRATION, /UPDATE OF "deletedAt", "moderationHiddenAt" ON "Message"/);
    assert.match(MIGRATION, /UPDATE OF "messagingRestrictedAt" ON "User"/);
    assert.ok(MIGRATION.includes(`'t', 'conversations'`));
  });

  it('lets the capture go with the author and with the report', () => {
    assert.match(MIGRATION, /"authorId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/);
    assert.match(MIGRATION, /"reportId"\) REFERENCES "MemberReport"\("id"\) ON DELETE CASCADE/);
  });

  it('is safe to run twice', () => {
    assert.ok(!/CREATE TRIGGER/.test(MIGRATION));
    assert.ok(!/CREATE TABLE "/.test(MIGRATION));
    assert.ok(!/CREATE (UNIQUE )?INDEX "/.test(MIGRATION));
    assert.ok(!/ADD COLUMN "/.test(MIGRATION));
    assert.ok(!/ADD VALUE '/.test(MIGRATION));
    assert.ok(/EXCEPTION WHEN duplicate_object/.test(MIGRATION));
  });
});
