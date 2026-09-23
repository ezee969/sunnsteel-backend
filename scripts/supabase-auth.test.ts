import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  createSign,
  generateKeyPairSync,
  KeyObject,
  randomUUID,
} from 'node:crypto';
import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  identityFromClaims,
  InvalidAccessTokenError,
  supabaseIssuer,
} from '../src/auth/access-token-claims';
import { SupabaseJwtStrategy } from '../src/auth/strategies/supabase-jwt.strategy';
import { SupabaseService } from '../src/auth/supabase.service';
import { DatabaseService } from '../src/database/database.service';

/**
 * TD-43. The guard verifies access tokens locally. These tests run the real
 * supabase-js `getClaims` against a stand-in Supabase Auth on localhost, which
 * serves a JWKS for a key generated here and counts what it is asked for, so
 * "no `/auth/v1/user` call" is observed rather than assumed.
 *
 * supabase-js keeps the JWKS in one cache per process (keyed by storage key),
 * shared by every client, so a test here can only count the fetches it
 * causes, never assume the cache starts empty.
 */

const KID = 'td43-test-key';
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const base64url = (value: string | Buffer) =>
  Buffer.from(value).toString('base64url');

function sign(
  payload: Record<string, unknown>,
  {
    key = privateKey,
    header = { alg: 'ES256', kid: KID, typ: 'JWT' },
  }: { key?: KeyObject; header?: Record<string, unknown> } = {},
) {
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign('SHA256')
    .update(input)
    .sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${base64url(signature)}`;
}

let server: Server;
let url: string;
const calls = { jwks: 0, user: 0 };

before(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/auth/v1/.well-known/jwks.json')) {
      calls.jwks += 1;
      const jwk = publicKey.export({ format: 'jwk' });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'ES256' }] }));
      return;
    }
    if (req.url?.startsWith('/auth/v1/user')) {
      calls.user += 1;
      res.statusCode = 403;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ code: 403, msg: 'invalid JWT' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  calls.jwks = 0;
  calls.user = 0;
});

const now = () => Math.floor(Date.now() / 1000);

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: `${url}/auth/v1`,
    sub: 'b3f8c2a4-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    exp: now() + 3600,
    iat: now(),
    email: 'member@example.com',
    user_metadata: { name: 'Member' },
    ...overrides,
  };
}

type Row = {
  id: string;
  email: string;
  supabaseUserId: string | null;
  name: string;
  username: string;
};

/** Just enough of `DatabaseService.user` for `getOrCreateUser`. */
function fakeDatabase(rows: Row[] = []) {
  const counts = { findUnique: 0, update: 0, create: 0 };
  let failNextCreateWithEmailConflict: Row | null = null;
  const user = {
    async findUnique({ where }: { where: Partial<Row> }) {
      counts.findUnique += 1;
      return (
        rows.find((row) =>
          where.supabaseUserId !== undefined
            ? row.supabaseUserId === where.supabaseUserId
            : row.email === where.email,
        ) ?? null
      );
    },
    async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
      counts.update += 1;
      const row = rows.find((candidate) => candidate.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    async create({ data }: { data: Omit<Row, 'id'> }) {
      counts.create += 1;
      if (failNextCreateWithEmailConflict) {
        // Another request created the account between our read and write.
        rows.push(failNextCreateWithEmailConflict);
        failNextCreateWithEmailConflict = null;
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['email'] },
        });
      }
      const row = { id: randomUUID(), ...data };
      rows.push(row);
      return row;
    },
  };
  return {
    db: { user } as unknown as DatabaseService,
    rows,
    counts,
    racedBy(row: Row) {
      failNextCreateWithEmailConflict = row;
    },
  };
}

function service(db = fakeDatabase().db) {
  const config = {
    get: (key: string) =>
      ({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'service-role' })[key],
  } as unknown as ConfigService;
  return new SupabaseService(db, config);
}

describe('TD-43 identityFromClaims', () => {
  const issuer = 'https://ref.supabase.co/auth/v1';
  const valid = {
    iss: issuer,
    sub: 'user-1',
    aud: 'authenticated',
    role: 'authenticated',
    exp: 2_000,
    email: 'a@example.com',
    user_metadata: { full_name: 'A' },
  };

  it('returns the identity a member token carries', () => {
    assert.deepEqual(identityFromClaims(valid, issuer, 1_000), {
      id: 'user-1',
      email: 'a@example.com',
      user_metadata: { full_name: 'A' },
    });
  });

  it('accepts an audience list that includes authenticated', () => {
    const identity = identityFromClaims(
      { ...valid, aud: ['other', 'authenticated'] },
      issuer,
      1_000,
    );
    assert.equal(identity.id, 'user-1');
  });

  for (const [claim, value] of [
    ['exp', 1_000],
    ['exp', undefined],
    ['iss', 'https://other.supabase.co/auth/v1'],
    ['aud', 'anon'],
    ['aud', undefined],
    ['role', 'anon'],
    ['role', 'service_role'],
    ['sub', ''],
    ['sub', undefined],
  ] as const) {
    it(`rejects ${claim} = ${JSON.stringify(value)}`, () => {
      assert.throws(
        () => identityFromClaims({ ...valid, [claim]: value }, issuer, 1_000),
        (error: unknown) =>
          error instanceof InvalidAccessTokenError && error.message === claim,
      );
    });
  }

  it('derives the issuer from the project url, trailing slash or not', () => {
    assert.equal(supabaseIssuer('https://ref.supabase.co/'), issuer);
    assert.equal(supabaseIssuer('https://ref.supabase.co'), issuer);
  });
});

describe('TD-43 verifyToken through getClaims', () => {
  it('makes no /auth/v1/user call and fetches the JWKS once for repeated requests', async () => {
    const auth = service();
    const token = sign(claims());
    for (let i = 0; i < 5; i += 1) {
      const identity = await auth.verifyToken(token);
      assert.equal(identity.id, claims().sub);
      assert.equal(identity.email, 'member@example.com');
    }
    assert.equal(calls.user, 0);
    assert.ok(calls.jwks <= 1, `fetched the JWKS ${calls.jwks} times`);
  });

  const rejected: Array<[string, () => string]> = [
    ['a malformed token', () => 'not-a-jwt'],
    ['three segments that are not a JWT', () => 'a.b.c'],
    ['an expired token', () => sign(claims({ exp: now() - 1 }))],
    ['a token signed by another key', () => sign(claims(), { key: other.privateKey })],
    [
      'a tampered payload',
      () => {
        const [header, , signature] = sign(claims()).split('.');
        return `${header}.${base64url(JSON.stringify(claims({ sub: 'someone-else' })))}.${signature}`;
      },
    ],
    ['another project’s issuer', () => sign(claims({ iss: 'https://other.supabase.co/auth/v1' }))],
    ['another audience', () => sign(claims({ aud: 'anon' }))],
    ['the anon role', () => sign(claims({ role: 'anon' }))],
    ['no subject', () => sign(claims({ sub: undefined }))],
  ];

  for (const [name, token] of rejected) {
    it(`rejects ${name} with 401 and no /auth/v1/user call`, async () => {
      await assert.rejects(service().verifyToken(token()), UnauthorizedException);
      assert.equal(calls.user, 0);
    });
  }

  it('sends a symmetric token to Supabase Auth, the documented fallback, and rejects it when Auth does', async () => {
    const hs256 = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims()))}.${base64url('x')}`;
    await assert.rejects(service().verifyToken(hs256), UnauthorizedException);
    assert.deepEqual(calls, { jwks: 0, user: 1 });
  });

  it('refetches the JWKS for a key id it has not seen, so a rotated key keeps working', async () => {
    const auth = service();
    await auth.verifyToken(sign(claims()));
    const fetchesBefore = calls.jwks;
    await assert.rejects(
      auth.verifyToken(sign(claims(), { header: { alg: 'ES256', kid: 'rotated', typ: 'JWT' } })),
      UnauthorizedException,
    );
    // The unknown kid forced a second fetch; it is still absent, so the token
    // is refused rather than trusted.
    assert.equal(calls.jwks, fetchesBefore + 1);
  });
});

describe('TD-43 getOrCreateUser from token claims', () => {
  const identity = (overrides: Partial<{ id: string; email: string }> = {}) => ({
    id: 'supabase-1',
    email: 'member@example.com',
    user_metadata: { name: 'Member' } as Record<string, unknown>,
    ...overrides,
  });
  const row = (overrides: Partial<Row> = {}): Row => ({
    id: 'local-1',
    email: 'member@example.com',
    supabaseUserId: 'supabase-1',
    name: 'Member',
    username: 'member',
    ...overrides,
  });

  it('resolves an existing member with one indexed lookup and no write', async () => {
    const fake = fakeDatabase([row()]);
    const user = await service(fake.db).getOrCreateUser(identity());
    assert.equal(user.id, 'local-1');
    assert.deepEqual(fake.counts, { findUnique: 1, update: 0, create: 0 });
  });

  it('follows the email the token carries', async () => {
    const fake = fakeDatabase([row({ email: 'old@example.com' })]);
    const user = await service(fake.db).getOrCreateUser(identity());
    assert.equal(user.email, 'member@example.com');
    assert.equal(fake.counts.update, 1);
  });

  it('links a legacy account that has the email and no Supabase id', async () => {
    const fake = fakeDatabase([row({ supabaseUserId: null })]);
    const user = await service(fake.db).getOrCreateUser(identity());
    assert.equal(user.id, 'local-1');
    assert.equal(user.supabaseUserId, 'supabase-1');
  });

  it('refuses an email already linked to another Supabase user', async () => {
    const fake = fakeDatabase([row({ supabaseUserId: 'supabase-other' })]);
    await assert.rejects(
      service(fake.db).getOrCreateUser(identity()),
      ConflictException,
    );
    assert.equal(fake.counts.update, 0);
  });

  it('creates a new member, named from the token metadata', async () => {
    const fake = fakeDatabase();
    const user = await service(fake.db).getOrCreateUser(identity());
    assert.equal(user.name, 'Member');
    assert.equal(user.supabaseUserId, 'supabase-1');
    assert.equal(fake.counts.create, 1);
  });

  it('falls back to the email name when the metadata carries none', async () => {
    const fake = fakeDatabase();
    const user = await service(fake.db).getOrCreateUser({
      ...identity(),
      user_metadata: { name: 42 },
    });
    assert.equal(user.name, 'member');
  });

  it('settles on the account a concurrent first request created', async () => {
    const fake = fakeDatabase();
    fake.racedBy(row({ supabaseUserId: null }));
    const user = await service(fake.db).getOrCreateUser(identity());
    assert.equal(user.id, 'local-1');
    assert.equal(user.supabaseUserId, 'supabase-1');
  });

  it('provisions the account on a first protected request, before /auth/supabase/verify', async () => {
    // The frontend does not wait for verify before its data reads, so the
    // guard alone must be able to create the member.
    const fake = fakeDatabase();
    const strategy = new SupabaseJwtStrategy(service(fake.db));
    const user = await strategy.validate(sign(claims()));
    assert.equal(user.supabaseUserId, claims().sub);
    assert.equal(fake.counts.create, 1);
    assert.equal(calls.user, 0);
  });

  it('answers 401 from the strategy for a token that fails verification', async () => {
    const strategy = new SupabaseJwtStrategy(service());
    await assert.rejects(
      strategy.validate(sign(claims({ role: 'anon' }))),
      UnauthorizedException,
    );
  });
});
