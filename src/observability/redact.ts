import type { Breadcrumb, Event } from '@sentry/nestjs';

/**
 * PLAT-02: what may leave the server in an error report or a trace.
 *
 * Nothing a member typed (request bodies, notes, messages, search queries), no
 * credential (bearer tokens, cookies, share tokens) and no address is sent.
 * The SDK is configured not to collect most of it in the first place
 * (`instrument.ts`); this is the second line, applied to every event and
 * transaction just before it is sent.
 */

/** Request headers worth keeping to read a report; everything else is dropped. */
const KEPT_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-length',
  'content-type',
  'origin',
  'user-agent',
]);

/** URL-valued span and breadcrumb attributes. */
const URL_KEYS = [
  'url',
  'url.full',
  'url.path',
  'http.url',
  'http.target',
  'from',
  'to',
];

/** Attributes naming the caller's address. */
const ADDRESS_KEYS = [
  'client.address',
  'client.port',
  'http.client_ip',
  'net.peer.ip',
  'net.peer.port',
  'net.sock.peer.addr',
  'net.sock.peer.port',
];

/** Every captured request or response header is dropped, filtered or not. */
const HEADER_PREFIXES = ['http.request.header.', 'http.response.header.'];

/** Attributes that only ever carry a query string. */
const QUERY_KEYS = ['url.query', 'http.query', 'http.fragment'];

/**
 * A share link's token is its only credential (`ROUT-04`, `SOC-07`), so it
 * never appears in a report; the query string and fragment go entirely,
 * because they carry search terms and recipients.
 */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const path = cut === -1 ? url : url.slice(0, cut);
  return path.replace(/(\/shared\/(?:sessions|routines)\/)[^/\s]+/g, '$1[token]');
}

function scrubData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of URL_KEYS) {
    const value = data[key];
    if (typeof value === 'string') data[key] = scrubUrl(value);
  }
  for (const key of QUERY_KEYS) delete data[key];
  for (const key of ADDRESS_KEYS) delete data[key];
  for (const key of Object.keys(data)) {
    if (HEADER_PREFIXES.some(prefix => key.startsWith(prefix))) delete data[key];
  }
}

export function redactBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Console lines repeat request URLs and messages verbatim.
  if (breadcrumb.category === 'console') return null;
  scrubData(breadcrumb.data);
  return breadcrumb;
}

export function redactEvent<T extends Event>(event: T): T {
  const request = event.request;
  if (request) {
    if (request.url) request.url = scrubUrl(request.url);
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    delete request.env;
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) =>
          KEPT_HEADERS.has(name.toLowerCase()),
        ),
      );
    }
  }

  // An account is named by its id only: never an email, a username or an IP.
  if (event.user) {
    event.user = event.user.id === undefined ? {} : { id: String(event.user.id) };
  }

  if (event.transaction) event.transaction = scrubUrl(event.transaction);

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(redactBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }

  scrubData(event.contexts?.trace?.data);
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubUrl(span.description);
    scrubData(span.data);
  }

  return event;
}
