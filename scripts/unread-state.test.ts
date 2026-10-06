import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MarkConversationReadDto } from '../src/messages/dto/messages.dto';
import { nextReadPosition, unreadCutoff } from '../src/messages/message-rules';

const MIGRATION = readFileSync(
  'prisma/migrations/20261006140000_unread_state/migration.sql',
  'utf8',
);
const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 10, minute));

describe('MSG-03 where unread starts', () => {
  it('is everything the other member wrote when nothing was ever read', () => {
    assert.equal(unreadCutoff(null, null), null);
  });

  it('is the read position, or the delete-for-me, whichever is later', () => {
    assert.deepEqual(unreadCutoff(at(5), null), at(5));
    assert.deepEqual(unreadCutoff(null, at(3)), at(3));
    assert.deepEqual(unreadCutoff(at(5), at(3)), at(5));
    assert.deepEqual(unreadCutoff(at(2), at(3)), at(3));
  });
});

describe('MSG-03 a read position', () => {
  it('moves to the message seen when there was none', () => {
    assert.deepEqual(nextReadPosition(null, at(4)), at(4));
  });

  it('moves forward only', () => {
    assert.deepEqual(nextReadPosition(at(4), at(6)), at(6));
    assert.equal(nextReadPosition(at(6), at(4)), null);
  });

  it('does not move for the message it already stands on', () => {
    assert.equal(nextReadPosition(at(4), at(4)), null);
  });

  it('is marked through a message id, nothing else', async () => {
    const good = plainToInstance(MarkConversationReadDto, {
      through: '11111111-1111-4111-8111-111111111111',
    });
    assert.equal((await validate(good)).length, 0);
    const bad = plainToInstance(MarkConversationReadDto, { through: 'latest' });
    assert.equal((await validate(bad)).length, 1);
  });
});

describe('MSG-03 migration', () => {
  it('backfills only in the statement that adds the column', () => {
    const block = MIGRATION.slice(
      MIGRATION.indexOf('IF NOT EXISTS'),
      MIGRATION.indexOf('END IF;'),
    );
    assert.match(block, /ADD COLUMN "lastReadAt"/);
    assert.match(block, /SET "lastReadAt" = c\."lastMessageAt"/);
    // Nothing outside it writes a read position, so a second run marks
    // nothing as read that became unread since.
    const outside = MIGRATION.replace(block, '');
    assert.ok(!/SET "lastReadAt"/.test(outside));
  });

  it('tells a reader\'s other tabs when their position moves', () => {
    assert.match(
      MIGRATION,
      /CREATE OR REPLACE TRIGGER "ConversationParticipant_realtime_signal_clear"\s+AFTER UPDATE OF "clearedAt", "lastReadAt"/,
    );
    assert.ok(!/CREATE TRIGGER/.test(MIGRATION));
  });
});
