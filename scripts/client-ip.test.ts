import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clientIp, normalizeIp } from '../src/common/client-ip';

/**
 * TD-46. The fixtures are the values production actually sent on 2026-09-22,
 * not invented ones: a guess about the shape of these headers is exactly what
 * the defect was.
 */
const RAILWAY = {
  'x-forwarded-for': '89.10.231.195, 79.127.151.146',
  'x-real-ip': '89.10.231.195',
  'x-railway-edge': 'osl1',
};
const CLIENT = '89.10.231.195';
const INTERNAL_HOP = '::ffff:100.64.0.2';

describe('TD-46 the caller behind Railway', () => {
  it('reports the client, not the internal hop the socket sees', () => {
    assert.equal(clientIp(RAILWAY, INTERNAL_HOP), CLIENT);
  });

  it('keeps one client on one key as the internal hop rotates', () => {
    // The measurement logged 100.64.0.2 through 100.64.0.8 for consecutive
    // requests from one caller. Keyed on that, a rate limit is not merely
    // shared -- it is spread across buckets and never reached.
    const keys = new Set(
      ['2', '3', '4', '5', '6', '7', '8'].map((n) =>
        clientIp(RAILWAY, `::ffff:100.64.0.${n}`),
      ),
    );
    assert.deepEqual([...keys], [CLIENT]);
  });

  it('ignores X-Forwarded-For, which the edge may append to', () => {
    // Railway overwrites it today, so its first entry is the client. Reading
    // it anyway would make this code correct by a property of one host that
    // nothing here enforces.
    const forged = {
      ...RAILWAY,
      'x-forwarded-for': '127.0.0.1, 89.10.231.195, 79.127.151.146',
    };
    assert.equal(clientIp(forged, INTERNAL_HOP), CLIENT);
  });

  it('takes the first entry when the header is repeated', () => {
    assert.equal(
      clientIp({ 'x-real-ip': ['89.10.231.195', '127.0.0.1'] }, INTERNAL_HOP),
      CLIENT,
    );
  });
});

describe('TD-46 off Railway', () => {
  it('falls back to the connection address when no edge set a header', () => {
    // A developer machine and the test suite: the socket peer is the honest
    // answer there, and there is no header to prefer over it.
    assert.equal(clientIp({}, '::1'), '::1');
    assert.equal(clientIp({}, '::ffff:127.0.0.1'), '127.0.0.1');
  });

  it('answers empty rather than throwing when there is neither', () => {
    assert.equal(clientIp({}, undefined), '');
  });

  it('ignores an empty or whitespace header instead of keying on it', () => {
    assert.equal(clientIp({ 'x-real-ip': '   ' }, '::1'), '::1');
  });
});

describe('TD-46 address normalisation', () => {
  it('unwraps an IPv4 address mapped into IPv6', () => {
    // Node reports an IPv4 peer on a dual-stack socket this way while a header
    // carries the plain form; untouched, one caller would hold two buckets and
    // miss an allowlist entry written the other way.
    assert.equal(normalizeIp('::ffff:89.10.231.195'), '89.10.231.195');
  });

  it('leaves a real IPv6 address alone', () => {
    assert.equal(normalizeIp('::1'), '::1');
    assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
  });

  it('leaves a plain IPv4 address alone', () => {
    assert.equal(normalizeIp('89.10.231.195'), '89.10.231.195');
  });
});
