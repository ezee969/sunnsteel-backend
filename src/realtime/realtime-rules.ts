import {
  isRealtimeTopic,
  REALTIME_MAX_STREAM_MS,
  REALTIME_MAX_STREAMS_PER_MEMBER,
  type RealtimeEvent,
  type RealtimeTopic,
} from "@sunsteel/contracts";

/**
 * MSG-06: the pure half of the realtime stream -- what a database signal
 * says, how an event is written on the wire, how long a stream may live and
 * who is listening. The Postgres listener and the HTTP response sit around
 * it in `realtime-listener.service.ts` and `realtime.controller.ts`.
 */

/** The channel the `ss_realtime_signal` trigger notifies. */
export const REALTIME_CHANNEL = "ss_realtime";

export interface RealtimeSignal {
  userId: string;
  topic: RealtimeTopic;
}

/** A trigger payload, `{"u": <member id>, "t": <topic>}`, or null. */
export function parseRealtimeSignal(
  payload: string | undefined,
): RealtimeSignal | null {
  if (!payload) return null;
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { u, t } = value as Record<string, unknown>;
  if (typeof u !== "string" || u.length === 0 || !isRealtimeTopic(t)) {
    return null;
  }
  return { userId: u, topic: t };
}

/** One event as Server-Sent Events writes it. */
export function sseFrame(event: RealtimeEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** A comment line: proxies see traffic, clients ignore it. */
export const SSE_HEARTBEAT = ": keep-alive\n\n";

/**
 * The `exp` of the bearer token on a request the guard has already accepted.
 * `SupabaseJwtGuard` verified the signature and every claim on this request
 * before the handler ran, which is the only reason reading the payload here
 * is safe; this never decides who the caller is.
 */
export function bearerExpirySeconds(
  authorization: string | undefined,
): number | null {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
    const exp = (claims as { exp?: unknown } | null)?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/**
 * How long a stream opened now may stay open: never past its token's expiry
 * (the server would otherwise keep trusting a token the client no longer
 * holds) and never past Railway's request limit.
 */
export function streamLifetimeMs(
  nowMs: number,
  expirySeconds: number | null,
): number {
  const untilExpiry =
    expirySeconds === null
      ? REALTIME_MAX_STREAM_MS
      : expirySeconds * 1000 - nowMs;
  return Math.max(0, Math.min(REALTIME_MAX_STREAM_MS, untilExpiry));
}

export interface RealtimeStream {
  id: number;
  userId: string;
  send(frame: string): void;
  close(): void;
}

/**
 * The streams open on this instance, by member. A member may hold
 * `REALTIME_MAX_STREAMS_PER_MEMBER`; opening one more closes the oldest, so a
 * forgotten tab never locks out the one in use.
 */
export class RealtimeHub {
  private readonly byUser = new Map<string, RealtimeStream[]>();

  add(stream: RealtimeStream): void {
    const streams = this.byUser.get(stream.userId) ?? [];
    streams.push(stream);
    this.byUser.set(stream.userId, streams);
    while (streams.length > REALTIME_MAX_STREAMS_PER_MEMBER) {
      const oldest = streams.shift();
      oldest?.close();
    }
  }

  remove(stream: RealtimeStream): void {
    const streams = this.byUser.get(stream.userId);
    if (!streams) return;
    const index = streams.findIndex((open) => open.id === stream.id);
    if (index >= 0) streams.splice(index, 1);
    if (streams.length === 0) this.byUser.delete(stream.userId);
  }

  /** Sends to every stream of one member; nothing when they have none here. */
  sendTo(userId: string, frame: string): number {
    const streams = this.byUser.get(userId) ?? [];
    for (const stream of streams) stream.send(frame);
    return streams.length;
  }

  sendToAll(frame: string): void {
    for (const streams of this.byUser.values()) {
      for (const stream of streams) stream.send(frame);
    }
  }

  closeAll(): void {
    for (const streams of [...this.byUser.values()]) {
      for (const stream of [...streams]) stream.close();
    }
    this.byUser.clear();
  }

  get size(): number {
    let count = 0;
    for (const streams of this.byUser.values()) count += streams.length;
    return count;
  }
}
