import * as assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ArgumentsHost,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { API_ERROR_MESSAGES, apiError } from "@sunsteel/contracts";

import { AllExceptionsFilter } from "../src/common/filters/http-exception.filter";

/** Runs the filter over one exception and returns the JSON it answered. */
function respond(exception: unknown, isProduction = false) {
  let body: Record<string, unknown> = {};
  let status = 0;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: Record<string, unknown>) {
      body = value;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: "POST", url: "/api/test" }),
    }),
  } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter(isProduction);
  // Quiet: the filter logs every error it answers.
  (filter as unknown as { logger: { error: () => void } }).logger = {
    error: () => undefined,
  };
  filter.catch(exception, host);
  return { status, body };
}

describe("I18N-06 stable refusal codes", () => {
  it("sends the code and its params beside the unchanged English", () => {
    const { status, body } = respond(
      new ConflictException(
        apiError("SESSION_BLOCK_IN_FORCE", {
          name: "Peak",
          endDate: "2026-10-05",
        }),
      ),
    );
    assert.equal(status, 409);
    assert.equal(body.code, "SESSION_BLOCK_IN_FORCE");
    assert.deepEqual(body.params, { name: "Peak", endDate: "2026-10-05" });
    assert.equal(
      body.message,
      'This routine follows the training block "Peak" until 2026-10-05; start one of its days',
    );
  });

  it("keeps a code without params free of a params field", () => {
    const { body } = respond(
      new NotFoundException(apiError("ROUTINE_NOT_FOUND")),
    );
    assert.equal(body.code, "ROUTINE_NOT_FOUND");
    assert.equal(body.message, "Routine not found");
    assert.equal("params" in body, false);
  });

  it("keeps a coded 5xx's sentence in production, and hides an uncoded one", () => {
    const coded = respond(
      new ServiceUnavailableException(apiError("ACCOUNT_DELETE_UNAVAILABLE")),
      true,
    );
    assert.equal(
      coded.body.message,
      API_ERROR_MESSAGES.ACCOUNT_DELETE_UNAVAILABLE,
    );
    assert.equal(coded.body.code, "ACCOUNT_DELETE_UNAVAILABLE");

    const internal = respond(
      new InternalServerErrorException("Missing Supabase configuration"),
      true,
    );
    assert.equal(internal.body.message, "Internal server error");
    assert.equal("code" in internal.body, false);
  });

  it("names the throttler's 429 without changing its message", () => {
    const { status, body } = respond(new ThrottlerException());
    assert.equal(status, 429);
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.message, API_ERROR_MESSAGES.RATE_LIMITED);
  });

  it("leaves validation a client never triggers uncoded", () => {
    const { body } = respond(new ConflictException("Invalid cursor"));
    assert.equal("code" in body, false);
    assert.equal(body.message, "Invalid cursor");
  });

  it("never throws a coded sentence as a bare string", () => {
    // A refusal that has a code must go through apiError, or the client can
    // only show it in English.
    const coded = new Set<string>(
      Object.values(API_ERROR_MESSAGES).filter((text) => !text.includes("{")),
    );
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".spec.ts")) {
          const source = readFileSync(path, "utf8");
          const pattern =
            /throw new \w+Exception\(\s*(['"])((?:(?!\1).)*)\1\s*,?\s*\)/g;
          for (const match of source.matchAll(pattern)) {
            if (coded.has(match[2])) offenders.push(`${path}: ${match[2]}`);
          }
        }
      }
    };
    walk(join(__dirname, "..", "src"));
    assert.deepEqual(offenders, []);
  });
});
