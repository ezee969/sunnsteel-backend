import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MESSAGE_ATTACHMENT_KINDS,
  MESSAGE_BODY_MAX,
  SHARED_ROUTINE_SOURCES,
  type SharedRoutineSummary,
  messageNote,
} from '@sunsteel/contracts';

import { SendMessageDto, StartConversationDto } from '../src/messages/dto/messages.dto';
import {
  captureMessages,
  messageFor,
  reportRefusal,
  type StoredMessage,
} from '../src/messages/message-moderation';
import { attachmentFor } from '../src/messages/message-routines';
import { readCloneSource } from '../src/routines/routine-cloning';

const MIGRATION = readFileSync(
  'prisma/migrations/20261007100000_message_attachments/migration.sql',
  'utf8',
);
const SENDER = '11111111-1111-4111-8111-111111111111';
const READER = '22222222-2222-4222-8222-222222222222';
const ROUTINE = '33333333-3333-4333-8333-333333333333';

const summary: SharedRoutineSummary = {
  routineId: ROUTINE,
  name: 'Upper / Lower',
  description: null,
  scheduleMode: 'WEEKLY',
  dayCount: 4,
  exerciseCount: 22,
  updatedAt: '2026-10-07T08:00:00.000Z',
};
const routines = new Map([[ROUTINE, summary]]);

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: 'm1',
    senderId: SENDER,
    body: null,
    deletedAt: null,
    moderationHiddenAt: null,
    attachmentKind: 'ROUTINE',
    attachmentId: ROUTINE,
    createdAt: new Date(Date.UTC(2026, 9, 7, 8, 0)),
    ...overrides,
  };
}

describe('MSG-07 a routine in a message', () => {
  it('reads as the routine is now, for both participants', () => {
    for (const viewer of [SENDER, READER]) {
      assert.deepEqual(messageFor(message(), viewer, routines).attachment, {
        kind: 'ROUTINE',
        routine: summary,
      });
    }
  });

  it('says it is no longer available once the routine is gone or hidden', () => {
    assert.deepEqual(messageFor(message(), READER).attachment, {
      kind: 'ROUTINE',
      routine: null,
    });
  });

  it('carries nothing when it carries nothing', () => {
    const plain = message({ body: 'hi', attachmentKind: null, attachmentId: null });
    assert.equal(messageFor(plain, READER, routines).attachment, null);
  });

  it('goes with the text: never once deleted, and not to the other member while hidden', () => {
    const deleted = message({ deletedAt: new Date() });
    for (const viewer of [SENDER, READER]) {
      assert.equal(attachmentFor(deleted, viewer, routines), null);
    }
    const hidden = message({ moderationHiddenAt: new Date() });
    assert.equal(attachmentFor(hidden, READER, routines), null);
    assert.deepEqual(attachmentFor(hidden, SENDER, routines), {
      kind: 'ROUTINE',
      routine: summary,
    });
  });

  it('may travel without a note, which is no text rather than a deleted one', () => {
    const seen = messageFor(message(), READER, routines);
    assert.equal(seen.body, null);
    assert.equal(seen.deleted, false);
  });

  it('can be reported even without a note, but never by its sender', () => {
    assert.equal(reportRefusal(message(), READER), null);
    assert.equal(reportRefusal(message(), SENDER), 'OWN');
    assert.equal(reportRefusal(message({ deletedAt: new Date() }), READER), 'UNREADABLE');
  });

  it('is captured by the name the reporter saw and nothing more of it', () => {
    const [captured] = captureMessages([message()], 'm1', READER, routines);
    assert.equal(captured.routineName, 'Upper / Lower');
    assert.equal(captured.body, null);
    const [gone] = captureMessages([message()], 'm1', READER);
    assert.equal(gone.routineName, '');
    const [plain] = captureMessages(
      [message({ body: 'hi', attachmentKind: null, attachmentId: null })],
      'm1',
      READER,
      routines,
    );
    assert.equal(plain.routineName, null);
  });
});

describe('MSG-07 what a send may carry', () => {
  it('leaves the note empty only beside a routine', () => {
    assert.equal(messageNote(undefined, true), null);
    assert.equal(messageNote('   ', true), null);
    assert.equal(messageNote('  try this  ', true), 'try this');
    assert.equal(messageNote(undefined, false), undefined);
    assert.equal(messageNote('  ', false), undefined);
    assert.equal(messageNote('x'.repeat(MESSAGE_BODY_MAX + 1), true), undefined);
  });

  it('takes a routine id and an optional body in both writes', async () => {
    const send = plainToInstance(SendMessageDto, { routineId: ROUTINE });
    assert.deepEqual(await validate(send), []);
    const start = plainToInstance(StartConversationDto, {
      recipient: 'ana',
      routineId: ROUTINE,
      body: 'try this',
    });
    assert.deepEqual(await validate(start), []);
    const bad = plainToInstance(SendMessageDto, { routineId: 'not-an-id' });
    assert.equal((await validate(bad)).length, 1);
  });

  it('is a kind of its own, and reading it is a source of its own', () => {
    assert.deepEqual([...MESSAGE_ATTACHMENT_KINDS], ['ROUTINE']);
    assert.ok((SHARED_ROUTINE_SOURCES as readonly string[]).includes('MESSAGE'));
  });
});

describe('MSG-07 cloning from a message', () => {
  it('names exactly one source', () => {
    assert.deepEqual(readCloneSource({ messageId: ' m1 ' }), {
      kind: 'MESSAGE',
      messageId: 'm1',
    });
    assert.deepEqual(readCloneSource({ routineId: ROUTINE }), {
      kind: 'VISIBILITY',
      routineId: ROUTINE,
    });
    for (const request of [
      {},
      { messageId: 'm1', routineId: ROUTINE },
      { messageId: 'm1', token: 'x'.repeat(24) },
      { messageId: '  ' },
    ]) {
      assert.throws(() => readCloneSource(request), /SOURCE_REQUIRED/);
    }
  });
});

describe('MSG-07 migration', () => {
  it('stores a typed reference, never a foreign key', () => {
    assert.match(MIGRATION, /"attachmentKind" "MessageAttachmentKind"/);
    assert.match(MIGRATION, /"attachmentId" TEXT/);
    assert.doesNotMatch(MIGRATION, /REFERENCES|FOREIGN KEY/);
  });

  it('is safe to run twice', () => {
    assert.match(MIGRATION, /WHEN duplicate_object THEN NULL/);
    assert.ok(!/ADD COLUMN "/.test(MIGRATION));
  });
});
