import type { IncomingHttpHeaders } from 'node:http';

/**
 * The caller's address, for the two controls that key on it: the global
 * throttler and the `/metrics` allowlist (TD-46).
 *
 * **Measured in production on 2026-09-22**, not assumed. One request to
 * `sunnsteel-backend-production.up.railway.app` arrived as:
 *
 * ```
 * req.ip          ::ffff:100.64.0.2      <- Railway's internal hop
 * X-Forwarded-For 89.10.231.195, 79.127.151.146
 * X-Real-IP       89.10.231.195          <- the client
 * ```
 *
 * Two things followed, and both are why this function exists.
 *
 * **`req.ip` alone is wrong, and wrong in a way that hides itself.** It is the
 * internal hop, and that hop *rotates*: consecutive requests from one client
 * were logged as `100.64.0.2` through `100.64.0.8`. Keying the rate limiter on
 * it does not put everyone in one bucket, it scatters one client across many,
 * so the limit is not enforced at all while appearing to be configured.
 *
 * **`X-Real-IP` cannot be forged through Railway's edge.** Requests sent with
 * `X-Real-IP: 127.0.0.1`, `X-Forwarded-For: 127.0.0.1` and `8.8.8.8` were
 * logged with none of those values present: the edge overwrites both headers
 * rather than appending to them. Trusting it is therefore safe *here*, which
 * is a fact about Railway and not about the header in general -- behind an
 * edge that passes a client's value through, this would be client-controlled.
 *
 * It is preferred over counting proxy hops with Express's `trust proxy`
 * because a hop count is a guess about topology that fails silently: if
 * Railway adds or removes an internal hop, `req.ip` quietly becomes a shared
 * edge address and the defect above returns with nothing to signal it.
 * `X-Real-IP` is set per request to the client whatever the topology.
 *
 * Off Railway -- a developer machine, a test -- the header is absent and the
 * connection address is the honest answer, so that is the fallback.
 */
export function clientIp(
	headers: IncomingHttpHeaders,
	connectionIp: string | undefined,
): string {
	const real = headers['x-real-ip'];
	// A repeated header arrives as an array; the first entry is the edge's.
	const header = Array.isArray(real) ? real[0] : real;
	const candidate = header?.trim();
	return normalizeIp(candidate || connectionIp || '');
}

/**
 * Node reports an IPv4 peer on a dual-stack socket as `::ffff:1.2.3.4`, while
 * a header carries the plain form. Left alone, one address would occupy two
 * throttle buckets and would miss an allowlist entry written either way.
 */
export function normalizeIp(ip: string): string {
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
	return mapped ? mapped[1] : ip;
}
