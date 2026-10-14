import * as assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  ArgumentsHost,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import type { Event } from "@sentry/nestjs";

/** An envelope as a transport receives it: headers, then [item header, payload] pairs. */
type Envelope = [unknown, Array<[{ type?: string }, unknown]>];

import { AllExceptionsFilter } from "../src/common/filters/http-exception.filter";
import {
  isRequestSpan,
  isUntracedRequest,
  sentryOptions,
  traceSampleRate,
} from "../src/observability/instrument";
import {
  redactBreadcrumb,
  redactEvent,
  scrubUrl,
} from "../src/observability/redact";

describe("PLAT-02 what leaves the server", () => {
  it("drops a share link's token, the query string and the fragment", () => {
    assert.equal(
      scrubUrl("https://api.example/api/shared/sessions/AbC-123_x?x=1"),
      "https://api.example/api/shared/sessions/[token]",
    );
    assert.equal(
      scrubUrl("/api/shared/routines/tok3n/extra#frag"),
      "/api/shared/routines/[token]/extra",
    );
    assert.equal(
      scrubUrl("GET /api/search/members?q=ana"),
      "GET /api/search/members",
    );
    assert.equal(scrubUrl("/api/routines/42"), "/api/routines/42");
  });

  it("keeps only harmless headers and drops bodies, cookies and queries", () => {
    const event = redactEvent({
      request: {
        url: "http://localhost:4000/api/shared/sessions/secret?q=1",
        method: "POST",
        headers: {
          Authorization: "Bearer eyJ.token",
          cookie: "ss_session=1",
          "x-real-ip": "203.0.113.9",
          "user-agent": "Mozilla",
          "content-type": "application/json",
        },
        data: { body: "a private message" },
        cookies: { ss_session: "1" },
        query_string: "q=ana",
        env: { REMOTE_ADDR: "203.0.113.9" },
      },
      user: { id: "user-1", email: "ana@example.com", ip_address: "203.0.113.9" },
    } as Event);

    assert.equal(
      event.request?.url,
      "http://localhost:4000/api/shared/sessions/[token]",
    );
    assert.deepEqual(event.request?.headers, {
      "user-agent": "Mozilla",
      "content-type": "application/json",
    });
    assert.equal(event.request?.data, undefined);
    assert.equal(event.request?.cookies, undefined);
    assert.equal(event.request?.query_string, undefined);
    assert.equal(event.request?.env, undefined);
    assert.deepEqual(event.user, { id: "user-1" });
  });

  it("names nobody when the account is unknown", () => {
    const event = redactEvent({ user: { ip_address: "203.0.113.9" } } as Event);
    assert.deepEqual(event.user, {});
  });

  it("scrubs breadcrumbs, spans and the trace, and drops console lines", () => {
    assert.equal(
      redactBreadcrumb({ category: "console", message: "[POST] /api/x" }),
      null,
    );
    assert.deepEqual(
      redactBreadcrumb({
        category: "http",
        data: { url: "/api/shared/routines/abc?x=1", "http.query": "x=1" },
      }),
      { category: "http", data: { url: "/api/shared/routines/[token]" } },
    );

    const event = redactEvent({
      type: "transaction",
      transaction: "GET /api/shared/sessions/:token",
      contexts: {
        trace: {
          trace_id: "t",
          span_id: "s",
          data: {
            "url.full": "http://x/api/shared/sessions/abc?q=1",
            "url.query": "q=1",
            "net.peer.ip": "203.0.113.9",
            "http.request.header.authorization": "[Filtered]",
            "http.request.header.baggage": "sentry-trace_id=t",
          },
        },
      },
      spans: [
        {
          span_id: "a",
          trace_id: "t",
          start_timestamp: 0,
          description: "GET http://x/api/search?q=ana",
          data: { "http.target": "/api/search?q=ana", "db.system": "postgresql" },
        },
      ],
    } as unknown as Event);

    assert.equal(event.transaction, "GET /api/shared/sessions/[token]");
    assert.deepEqual(event.contexts?.trace?.data, {
      "url.full": "http://x/api/shared/sessions/[token]",
    });
    assert.equal(event.spans?.[0].description, "GET http://x/api/search");
    assert.deepEqual(event.spans?.[0].data, {
      "http.target": "/api/search",
      "db.system": "postgresql",
    });
  });
});

describe("PLAT-02 configuration", () => {
  it("initialises nothing without a DSN", () => {
    assert.equal(sentryOptions({}), null);
    assert.equal(sentryOptions({ SENTRY_DSN: "  " }), null);
  });

  it("never sends default personal data and names the release", () => {
    const options = sentryOptions({
      SENTRY_DSN: "http://key@localhost:9/1",
      NODE_ENV: "production",
      RAILWAY_GIT_COMMIT_SHA: "abc123",
    });
    assert.equal(options?.sendDefaultPii, false);
    assert.equal(options?.release, "abc123");
    assert.equal(options?.environment, "production");
  });

  it("samples every trace in development and a fifth in production", () => {
    assert.equal(traceSampleRate({}), 1);
    assert.equal(traceSampleRate({ NODE_ENV: "production" }), 0.2);
    assert.equal(
      traceSampleRate({ NODE_ENV: "production", SENTRY_TRACES_SAMPLE_RATE: "0.5" }),
      0.5,
    );
    assert.equal(traceSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "2" }), 1);
    assert.equal(traceSampleRate({ SENTRY_TRACES_SAMPLE_RATE: "half" }), 1);
  });

  it("traces requests only, never a sweep's own queries", () => {
    assert.ok(isRequestSpan("http.server", undefined));
    assert.ok(isRequestSpan(undefined, { url: "/api/x" }));
    assert.ok(!isRequestSpan("db", undefined));
    assert.ok(!isRequestSpan(undefined, undefined));
  });

  it("never traces the healthcheck, the metrics scrape or the realtime stream", () => {
    assert.ok(isUntracedRequest("http://localhost:4000/api/health"));
    assert.ok(isUntracedRequest("/api/metrics?x=1"));
    assert.ok(isUntracedRequest("GET /api/realtime/stream"));
    assert.ok(!isUntracedRequest("/api/healthy"));
    assert.ok(!isUntracedRequest("GET /api/routines"));
    assert.ok(!isUntracedRequest(undefined));
  });
});

describe("PLAT-02 the exception filter reports server faults", () => {
  const envelopes: Envelope[] = [];

  before(() => {
    const options = sentryOptions({ SENTRY_DSN: "http://key@localhost:9/1" });
    assert.ok(options);
    Sentry.init({
      ...options,
      transport: () => ({
        send: async (envelope: Envelope) => {
          envelopes.push(envelope);
          return {};
        },
        flush: async () => true,
      }),
    });
  });

  after(async () => {
    await Sentry.close();
  });

  function catchWith(exception: unknown) {
    const response = {
      status() {
        return this;
      },
      json() {},
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: "GET", url: "/api/test" }),
      }),
    } as unknown as ArgumentsHost;
    const filter = new AllExceptionsFilter(false);
    (filter as unknown as { logger: { error: () => void } }).logger = {
      error: () => undefined,
    };
    filter.catch(exception, host);
  }

  function reportedEvents(): Event[] {
    return envelopes.flatMap(([, items]) =>
      items
        .filter(([header]) => header.type === "event")
        .map(([, payload]) => payload as Event),
    );
  }

  it("reports a 5xx once and a refusal never", async () => {
    catchWith(new NotFoundException("Routine not found"));
    catchWith(new InternalServerErrorException("boom"));
    catchWith(new Error("unexpected"));
    await Sentry.flush(2000);

    const messages = reportedEvents().map(
      event => event.exception?.values?.[0]?.value,
    );
    assert.deepEqual(messages, ["boom", "unexpected"]);
  });
});
