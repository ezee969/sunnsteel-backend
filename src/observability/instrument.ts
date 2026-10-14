import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import * as Sentry from '@sentry/nestjs';

import { redactBreadcrumb, redactEvent } from './redact';

/**
 * PLAT-02: error reports and traces, through Sentry.
 *
 * Imported by `main.ts` before Nest, Express, `pg` or Prisma load, because the
 * SDK instruments them as they are required. **Without `SENTRY_DSN` nothing is
 * initialised** and the server runs exactly as before, as push does without
 * its VAPID keys.
 */

/** Traces kept outside production, where every request is worth seeing. */
const DEVELOPMENT_TRACE_RATE = 1;
/** Traces kept in production unless `SENTRY_TRACES_SAMPLE_RATE` says otherwise. */
const PRODUCTION_TRACE_RATE = 0.2;

/**
 * Requests never traced: the healthcheck and the metrics scrape run on a
 * timer, and the realtime stream is one request held open for minutes.
 */
const UNTRACED_PATHS = ['/api/health', '/api/metrics', '/api/realtime/stream'];

type Env = Record<string, string | undefined>;

export function traceSampleRate(env: Env): number {
  const fallback =
    env.NODE_ENV === 'production'
      ? PRODUCTION_TRACE_RATE
      : DEVELOPMENT_TRACE_RATE;
  const raw = env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw.trim() === '') return fallback;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : fallback;
}

export function isUntracedRequest(target: string | undefined): boolean {
  if (!target) return false;
  // A full URL, a bare path or a transaction name ("GET /api/health").
  const path = (target.split(/[?#]/)[0].split(' ').pop() ?? '').replace(
    /^[a-z]+:\/\/[^/]+/i,
    '',
  );
  return UNTRACED_PATHS.includes(path);
}

export function isRequestSpan(op: unknown, request: unknown): boolean {
  return op === 'http.server' || request !== undefined;
}

/** The options `Sentry.init` receives, or null when no DSN is configured. */
export function sentryOptions(env: Env): Sentry.NodeOptions | null {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return null;
  const rate = traceSampleRate(env);

  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    release: env.RAILWAY_GIT_COMMIT_SHA || undefined,
    // No cookie, request body or query string is collected; `redactEvent` is
    // the second line for whatever an integration adds.
    sendDefaultPii: false,
    integrations: [
      Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }),
      Sentry.requestDataIntegration({
        include: { cookies: false, data: false, query_string: false },
      }),
      Sentry.prismaIntegration(),
    ],
    tracesSampler: ({ name, attributes, normalizedRequest, inheritOrSampleWith }) => {
      // Only requests are traced. The push and reminder sweeps run every few
      // seconds and would otherwise each start a trace of their own queries.
      if (!isRequestSpan(attributes?.['sentry.op'], normalizedRequest)) return 0;
      const path = normalizedRequest?.url ?? attributes?.['url.path'];
      if (isUntracedRequest(String(path ?? '')) || isUntracedRequest(name)) {
        return 0;
      }
      // A trace the browser started keeps the browser's decision.
      return inheritOrSampleWith(rate);
    },
    beforeSend: event => redactEvent(event),
    beforeSendTransaction: event => redactEvent(event),
    beforeBreadcrumb: breadcrumb => redactBreadcrumb(breadcrumb),
  };
}

/**
 * This runs before `ConfigModule` loads `.env`, so a local `.env` would go
 * unread; its `SENTRY_*` values are read here, never overriding the real
 * environment, which is the only source in production.
 */
function sentryEnv(): Env {
  const env: Env = { ...process.env };
  const file = resolve(process.cwd(), '.env');
  if (!existsSync(file)) return env;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (key.startsWith('SENTRY_') && env[key] === undefined) env[key] = value;
  }
  return env;
}

const options = sentryOptions(sentryEnv());
if (options) Sentry.init(options);
