import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  MESSAGE_PERMISSIONS,
  MESSAGE_REQUEST_DECLINE_COOLDOWN_DAYS,
} from '@sunsteel/contracts';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ListConversationsQueryDto,
  UpdateMessagePermissionDto,
} from '../src/messages/dto/messages.dto';
import {
  admissionFor,
  maySendTo,
  requestFor,
  requestSendOutcome,
  type RequestSendFacts,
} from '../src/messages/message-rules';

const MIGRATION = readFileSync(
  'prisma/migrations/20261006180000_message_requests/migration.sql',
  'utf8',
);
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(Date.UTC(2026, 9, 6, 12));

describe('MSG-02 where a first message goes', () => {
  const base = {
    recipientFollowsSender: false,
    hasConversation: false,
    senderHidden: false,
    senderRestricted: false,
  };

  it('a stranger lands in Requests only under Everyone', () => {
    assert.equal(admissionFor({ ...base, permission: 'EVERYONE' }), 'REQUEST');
    assert.equal(admissionFor({ ...base, permission: 'FOLLOWED' }), 'REFUSED');
    assert.equal(admissionFor({ ...base, permission: 'NOBODY' }), 'REFUSED');
  });

  it('a member the recipient follows reaches the inbox under Everyone too', () => {
    assert.equal(
      admissionFor({ ...base, permission: 'EVERYONE', recipientFollowsSender: true }),
      'INBOX',
    );
  });

  it('Nobody still refuses everyone new, followed or not', () => {
    assert.equal(
      admissionFor({ ...base, permission: 'NOBODY', recipientFollowsSender: true }),
      'REFUSED',
    );
  });

  it('a hidden or restricted sender starts nothing, request or not', () => {
    assert.equal(admissionFor({ ...base, permission: 'EVERYONE', senderHidden: true }), 'REFUSED');
    assert.equal(admissionFor({ ...base, permission: 'EVERYONE', senderRestricted: true }), 'REFUSED');
  });

  it('a request counts as being allowed to write', () => {
    assert.equal(maySendTo({ ...base, permission: 'EVERYONE' }), true);
  });
});

describe('MSG-02 what a message does to a request', () => {
  const base: RequestSendFacts = {
    status: 'PENDING',
    viewerIsRequester: true,
    otherFollowsViewer: false,
    otherPermission: 'EVERYONE',
    declinedAt: null,
    now: NOW,
  };

  it('nothing changes in an accepted conversation', () => {
    assert.equal(requestSendOutcome({ ...base, status: 'ACCEPTED' }), 'SEND');
  });

  it('its sender waits after the first message', () => {
    assert.equal(requestSendOutcome(base), 'PENDING');
  });

  it('its recipient writing accepts it, pending or declined', () => {
    assert.equal(requestSendOutcome({ ...base, viewerIsRequester: false }), 'ACCEPT_AND_SEND');
    assert.equal(
      requestSendOutcome({ ...base, viewerIsRequester: false, status: 'DECLINED', declinedAt: NOW }),
      'ACCEPT_AND_SEND',
    );
  });

  it('a follow from the recipient lets its sender in', () => {
    assert.equal(requestSendOutcome({ ...base, otherFollowsViewer: true }), 'ACCEPT_AND_SEND');
    assert.equal(
      requestSendOutcome({ ...base, otherFollowsViewer: true, otherPermission: 'NOBODY' }),
      'PENDING',
    );
  });

  it('after a decline its sender waits 30 days, told only "not taking messages"', () => {
    assert.equal(MESSAGE_REQUEST_DECLINE_COOLDOWN_DAYS, 30);
    const declined = { ...base, status: 'DECLINED' as const };
    assert.equal(
      requestSendOutcome({ ...declined, declinedAt: new Date(NOW.getTime() - 29 * DAY) }),
      'REFUSED',
    );
    assert.equal(
      requestSendOutcome({ ...declined, declinedAt: new Date(NOW.getTime() - 30 * DAY) }),
      'REREQUEST',
    );
  });

  it('and only while the recipient still lets everyone in', () => {
    assert.equal(
      requestSendOutcome({
        ...base,
        status: 'DECLINED',
        otherPermission: 'FOLLOWED',
        declinedAt: new Date(NOW.getTime() - 60 * DAY),
      }),
      'REFUSED',
    );
  });
});

describe('MSG-02 how a request reads', () => {
  it('its sender sees it waiting, pending or declined alike', () => {
    assert.deepEqual(requestFor('PENDING', true), { direction: 'OUTGOING' });
    assert.deepEqual(requestFor('DECLINED', true), { direction: 'OUTGOING' });
  });

  it('its recipient sees it until it is accepted', () => {
    assert.deepEqual(requestFor('PENDING', false), { direction: 'INCOMING' });
    assert.equal(requestFor('ACCEPTED', false), null);
    assert.equal(requestFor('ACCEPTED', true), null);
  });
});

describe('MSG-02 requests', () => {
  it('offer Everyone as the third setting', async () => {
    assert.deepEqual([...MESSAGE_PERMISSIONS].sort(), ['EVERYONE', 'FOLLOWED', 'NOBODY']);
    for (const messagePermission of MESSAGE_PERMISSIONS) {
      const dto = plainToInstance(UpdateMessagePermissionDto, { messagePermission });
      assert.deepEqual(await validate(dto), [], messagePermission);
    }
    const anyone = plainToInstance(UpdateMessagePermissionDto, { messagePermission: 'ANYONE' });
    assert.equal((await validate(anyone)).length, 1);
  });

  it('list the inbox or the requests, nothing else', async () => {
    for (const box of ['INBOX', 'REQUESTS']) {
      assert.deepEqual(await validate(plainToInstance(ListConversationsQueryDto, { box })), [], box);
    }
    assert.equal((await validate(plainToInstance(ListConversationsQueryDto, { box: 'SPAM' }))).length, 1);
  });
});

describe('MSG-02 migration', () => {
  it('tells the sender nothing about a decline', () => {
    assert.match(MIGRATION, /NEW\."status" <> 'DECLINED' OR "userId" IS DISTINCT FROM NEW\."startedById"/);
    assert.match(MIGRATION, /AFTER UPDATE OF "status" ON "Conversation"/);
  });

  it('leaves every existing conversation accepted', () => {
    assert.match(MIGRATION, /"status" "ConversationStatus" NOT NULL DEFAULT 'ACCEPTED'/);
  });

  it('is safe to run twice', () => {
    assert.ok(!/CREATE TRIGGER/.test(MIGRATION));
    assert.ok(!/ADD COLUMN "/.test(MIGRATION));
    assert.ok(!/ADD VALUE '/.test(MIGRATION));
    assert.match(MIGRATION, /EXCEPTION WHEN duplicate_object/);
  });
});
