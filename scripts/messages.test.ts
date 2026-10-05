import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  MESSAGE_BODY_MAX,
  messageBodyLength,
  normalizeMessageBody,
  REALTIME_TOPICS,
} from '@sunsteel/contracts';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  SendMessageDto,
  UpdateMessagePermissionDto,
} from '../src/messages/dto/messages.dto';
import {
  conversationPairKey,
  decodeKeysetCursor,
  encodeKeysetCursor,
  isAbandoned,
  isListed,
  maySendTo,
  utcWallClock,
} from '../src/messages/message-rules';

const MIGRATION = readFileSync(
  'prisma/migrations/20261005140000_direct_messages/migration.sql',
  'utf8',
);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('MSG-01 who may message whom', () => {
  const base = {
    permission: 'FOLLOWED' as const,
    recipientFollowsSender: false,
    hasConversation: false,
    senderHidden: false,
  };

  it('a member the recipient follows may start; anyone else may not', () => {
    assert.equal(maySendTo({ ...base, recipientFollowsSender: true }), true);
    assert.equal(maySendTo(base), false);
  });

  it('Nobody refuses a new conversation even from a member they follow', () => {
    assert.equal(
      maySendTo({ ...base, permission: 'NOBODY', recipientFollowsSender: true }),
      false,
    );
  });

  it('an existing conversation keeps working whatever the setting says now', () => {
    assert.equal(maySendTo({ ...base, permission: 'NOBODY', hasConversation: true }), true);
    assert.equal(maySendTo({ ...base, hasConversation: true }), true);
  });

  it('a member hidden by moderation messages no one, not even in a conversation', () => {
    assert.equal(
      maySendTo({ ...base, recipientFollowsSender: true, hasConversation: true, senderHidden: true }),
      false,
    );
  });

  it('a pair has one key whichever of them starts', () => {
    assert.equal(conversationPairKey(A, B), conversationPairKey(B, A));
    assert.equal(conversationPairKey(A, B), `${A}:${B}`);
    assert.ok(conversationPairKey(A, B).length <= 73);
  });
});

describe('MSG-01 deleting a conversation', () => {
  const at = (s: string) => new Date(`2026-10-05T${s}:00.000Z`);

  it('stays listed until deleted, and comes back with a newer message', () => {
    assert.equal(isListed(null, at('10:00')), true);
    assert.equal(isListed(at('10:00'), at('10:00')), false);
    assert.equal(isListed(at('10:00'), at('10:01')), true);
  });

  it('is removed only once every participant still in it has deleted it', () => {
    assert.equal(isAbandoned([{ clearedAt: at('10:05') }, { clearedAt: null }], at('10:00')), false);
    assert.equal(
      isAbandoned([{ clearedAt: at('10:05') }, { clearedAt: at('09:00') }], at('10:00')),
      false,
    );
    assert.equal(
      isAbandoned([{ clearedAt: at('10:05') }, { clearedAt: at('10:01') }], at('10:00')),
      true,
    );
    // A deleted member's row is gone: the one who stays decides alone.
    assert.equal(isAbandoned([{ clearedAt: at('10:05') }], at('10:00')), true);
  });
});

describe('MSG-01 cursors', () => {
  it('round-trips and refuses anything it did not hand out', () => {
    const cursor = { at: new Date('2026-10-05T10:00:00.123Z'), id: A };
    assert.deepEqual(decodeKeysetCursor(encodeKeysetCursor(cursor)), cursor);
    assert.equal(decodeKeysetCursor('nonsense'), null);
    assert.equal(
      decodeKeysetCursor(Buffer.from('2026-10-05T10:00:00Z|not-an-id').toString('base64url')),
      null,
    );
  });

  it('compares raw timestamps by the UTC wall clock', () => {
    assert.equal(utcWallClock(new Date('2026-10-05T10:00:00.123Z')), '2026-10-05T10:00:00.123');
  });
});

describe('MSG-01 message bodies', () => {
  it('keeps the lines inside, trims the ends and makes line endings one kind', () => {
    assert.equal(normalizeMessageBody('  hello\r\n\r\nthere  '), 'hello\n\nthere');
  });

  it('refuses an empty message and one over the limit, counting an emoji once', () => {
    assert.equal(normalizeMessageBody('   \n '), null);
    assert.equal(messageBodyLength('💪'), 1);
    assert.equal(normalizeMessageBody('💪'.repeat(MESSAGE_BODY_MAX))?.length, MESSAGE_BODY_MAX * 2);
    assert.equal(normalizeMessageBody('a'.repeat(MESSAGE_BODY_MAX + 1)), null);
  });

  it('accepts a body of emoji at the limit through the request bound', async () => {
    const dto = plainToInstance(SendMessageDto, { body: '💪'.repeat(MESSAGE_BODY_MAX) });
    assert.deepEqual(await validate(dto), []);
  });

  it('takes only the settings MSG-01 offers', async () => {
    for (const messagePermission of ['FOLLOWED', 'NOBODY']) {
      const dto = plainToInstance(UpdateMessagePermissionDto, { messagePermission });
      assert.deepEqual(await validate(dto), [], messagePermission);
    }
    const everyone = plainToInstance(UpdateMessagePermissionDto, {
      messagePermission: 'EVERYONE',
    });
    assert.equal((await validate(everyone)).length, 1);
  });
});

describe('MSG-01 migration', () => {
  it('announces conversations to the realtime stream on every change that moves a list', () => {
    assert.ok((REALTIME_TOPICS as readonly string[]).includes('conversations'));
    for (const table of ['"Message"', '"ConversationParticipant"', '"UserBlock"']) {
      assert.ok(MIGRATION.includes(`ON ${table}`), table);
    }
    assert.ok(MIGRATION.includes(`'t', 'conversations'`));
  });

  it('is safe to run twice', () => {
    assert.ok(!/CREATE TRIGGER/.test(MIGRATION));
    assert.ok(!/CREATE TABLE "/.test(MIGRATION));
    assert.ok(!/CREATE (UNIQUE )?INDEX "/.test(MIGRATION));
    assert.ok(!/ADD COLUMN "/.test(MIGRATION));
    assert.ok(/EXCEPTION WHEN duplicate_object/.test(MIGRATION));
  });
});
