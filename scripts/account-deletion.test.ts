import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { matchesDeletionConfirmation } from '@sunsteel/contracts';
import { SupabaseService } from '../src/auth/supabase.service';
import { DatabaseService } from '../src/database/database.service';
import { AccountDeletionService } from '../src/users/account-deletion.service';

/**
 * TRUST-01. The deletion runs against a stand-in Supabase on localhost that
 * serves the admin delete and the storage list/remove calls supabase-js
 * makes, so what is asked of Supabase, and in which order, is observed.
 */

const LOCAL_ID = '11111111-1111-4111-8111-111111111111';
const SUPABASE_ID = '22222222-2222-4222-8222-222222222222';

type Behaviour = {
  bucket: 'present' | 'missing' | 'failing';
  objects: string[];
  adminDelete: 'ok' | 'missing' | 'failing';
};

let server: Server;
let url: string;
let behaviour: Behaviour;
const log: string[] = [];
let removed: string[] = [];

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : undefined));
  });
}

before(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    const json = (status: number, payload: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(payload));
    };
    if (
      req.url === '/storage/v1/object/list/avatars' &&
      req.method === 'POST'
    ) {
      log.push(`list ${body.prefix}`);
      if (behaviour.bucket === 'missing') {
        return json(400, {
          statusCode: '404',
          error: 'Bucket not found',
          message: 'Bucket not found',
        });
      }
      if (behaviour.bucket === 'failing') {
        return json(500, {
          statusCode: '500',
          error: 'Internal',
          message: 'storage is down',
        });
      }
      // Storage lists one folder: the objects directly inside it, by bare name.
      const folder = `${body.prefix}/`;
      return json(
        200,
        behaviour.objects
          .filter((path) => path.startsWith(folder))
          .map((path) => path.slice(folder.length))
          .filter((name) => !name.includes('/'))
          .map((name) => ({ name, id: name })),
      );
    }
    if (req.url === '/storage/v1/object/avatars' && req.method === 'DELETE') {
      log.push(`remove ${body.prefixes.length}`);
      removed = body.prefixes;
      return json(
        200,
        body.prefixes.map((name: string) => ({ name })),
      );
    }
    if (
      req.url === `/auth/v1/admin/users/${SUPABASE_ID}` &&
      req.method === 'DELETE'
    ) {
      log.push('admin delete');
      if (behaviour.adminDelete === 'missing')
        return json(404, { code: 404, msg: 'User not found' });
      if (behaviour.adminDelete === 'failing')
        return json(500, { code: 500, msg: 'auth is down' });
      return json(200, { id: SUPABASE_ID });
    }
    json(404, { message: `unexpected ${req.method} ${req.url}` });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  behaviour = { bucket: 'present', objects: [], adminDelete: 'ok' };
  log.length = 0;
  removed = [];
});

type Account = {
  id: string;
  username: string;
  isModerator: boolean;
  supabaseUserId: string | null;
};

/**
 * A database whose transaction commits only when its callback resolves, the
 * way Prisma's interactive transaction does, so a rollback is observable.
 */
function fakeDatabase(account: Account | null) {
  const state = { account, committed: false, deletedIds: [] as string[] };
  const db = {
    user: {
      async findUnique() {
        return state.account;
      },
    },
    async $transaction(
      run: (tx: unknown) => Promise<void>,
      options?: { timeout?: number },
    ) {
      assert.ok(options?.timeout, 'the transaction must be bounded');
      const pending: string[] = [];
      await run({
        user: {
          async delete({ where }: { where: { id: string } }) {
            log.push('local delete');
            pending.push(where.id);
          },
        },
      });
      state.deletedIds.push(...pending);
      state.committed = true;
    },
  };
  return { db: db as unknown as DatabaseService, state };
}

function deletion(db: DatabaseService) {
  const config = {
    get: (key: string) =>
      ({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'service-role' })[key],
  } as unknown as ConfigService;
  return new AccountDeletionService(db, new SupabaseService(db, config));
}

const member = (overrides: Partial<Account> = {}): Account => ({
  id: LOCAL_ID,
  username: 'athena',
  isModerator: false,
  supabaseUserId: SUPABASE_ID,
  ...overrides,
});

describe('TRUST-01 matchesDeletionConfirmation', () => {
  it('accepts the username as typed, ignoring case, whitespace and a leading @', () => {
    for (const typed of ['athena', ' Athena ', '@athena', 'ATHENA']) {
      assert.equal(matchesDeletionConfirmation(typed, 'athena'), true, typed);
    }
  });

  it('refuses anything else, including an empty confirmation', () => {
    for (const typed of ['', ' ', '@', 'athen', 'athena2', 'a thena']) {
      assert.equal(matchesDeletionConfirmation(typed, 'athena'), false, typed);
    }
  });
});

describe('TRUST-01 deleteAccount', () => {
  it('removes the avatars, then deletes the local account and the Supabase sign-in in one transaction', async () => {
    behaviour.objects = [
      `${SUPABASE_ID}/1790000000000.jpg`,
      `${SUPABASE_ID}/1790000000001.jpg`,
      // Another member's folder, and a file that merely names the id, survive.
      '33333333-3333-4333-8333-333333333333/1790000000002.jpg',
      `${SUPABASE_ID}-legacy.jpeg`,
    ];
    const { db, state } = fakeDatabase(member());
    const response = await deletion(db).deleteAccount(LOCAL_ID, '@Athena');

    assert.ok(Date.parse(response.deletedAt));
    assert.deepEqual(removed.sort(), [
      `${SUPABASE_ID}/1790000000000.jpg`,
      `${SUPABASE_ID}/1790000000001.jpg`,
    ]);
    assert.deepEqual(log, [
      `list ${SUPABASE_ID}`,
      'remove 2',
      'local delete',
      'admin delete',
    ]);
    assert.deepEqual(state.deletedIds, [LOCAL_ID]);
    assert.equal(state.committed, true);
  });

  it('deletes an account with no stored avatars and no avatars bucket', async () => {
    behaviour.bucket = 'missing';
    const { db, state } = fakeDatabase(member());
    await deletion(db).deleteAccount(LOCAL_ID, 'athena');
    assert.equal(state.committed, true);
    assert.ok(!log.some((line) => line.startsWith('remove')));
  });

  it('refuses a confirmation that does not match, before touching anything', async () => {
    const { db, state } = fakeDatabase(member());
    await assert.rejects(
      deletion(db).deleteAccount(LOCAL_ID, 'athen'),
      BadRequestException,
    );
    assert.deepEqual(log, []);
    assert.equal(state.committed, false);
  });

  it('refuses a moderator account, so the append-only record is never cascaded away', async () => {
    const { db, state } = fakeDatabase(member({ isModerator: true }));
    await assert.rejects(
      deletion(db).deleteAccount(LOCAL_ID, 'athena'),
      ConflictException,
    );
    assert.deepEqual(log, []);
    assert.equal(state.committed, false);
  });

  it('deletes nothing when stored avatars cannot be listed', async () => {
    behaviour.bucket = 'failing';
    const { db, state } = fakeDatabase(member());
    await assert.rejects(
      deletion(db).deleteAccount(LOCAL_ID, 'athena'),
      ServiceUnavailableException,
    );
    assert.equal(state.committed, false);
    assert.ok(!log.includes('local delete'));
  });

  it('rolls the local deletion back when Supabase refuses to delete the sign-in', async () => {
    behaviour.adminDelete = 'failing';
    const { db, state } = fakeDatabase(member());
    await assert.rejects(
      deletion(db).deleteAccount(LOCAL_ID, 'athena'),
      ServiceUnavailableException,
    );
    assert.equal(state.committed, false);
    assert.deepEqual(state.deletedIds, []);
  });

  it('finishes a retried deletion whose sign-in is already gone', async () => {
    behaviour.adminDelete = 'missing';
    const { db, state } = fakeDatabase(member());
    await deletion(db).deleteAccount(LOCAL_ID, 'athena');
    assert.equal(state.committed, true);
  });

  it('deletes a legacy account that has no Supabase sign-in without calling Supabase Auth', async () => {
    const { db, state } = fakeDatabase(member({ supabaseUserId: null }));
    await deletion(db).deleteAccount(LOCAL_ID, 'athena');
    assert.equal(state.committed, true);
    assert.ok(!log.includes('admin delete'));
    // No sign-in means no folder the upload could have written to.
    assert.ok(!log.some((line) => line.startsWith('list')));
  });
});
