import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { REALTIME_HEARTBEAT_MS, REALTIME_TOPICS } from "@sunsteel/contracts";
import { Client } from "pg";
import {
  parseRealtimeSignal,
  REALTIME_CHANNEL,
  RealtimeHub,
  type RealtimeStream,
  SSE_HEARTBEAT,
  sseFrame,
} from "./realtime-rules";

export type RealtimeStatus = "disabled" | "listening" | "reconnecting";

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * MSG-06: one Postgres `LISTEN` per instance, and the streams open on it.
 *
 * Prisma cannot `LISTEN`, so this holds a plain `pg` connection of its own.
 * The `ss_realtime_signal` trigger notifies on commit; every instance hears
 * every signal and passes it to the streams it holds, which is the whole
 * fan-out. When the connection drops, signals sent meanwhile are lost, so
 * once it is back every open stream is told to re-read (`ready`), exactly as
 * a stream that reconnects is.
 *
 * `REALTIME_DISABLED=true` is the kill switch: no connection, and the stream
 * answers 503 so the client keeps polling.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly hub = new RealtimeHub();
  private client: Client | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private stopped = false;
  private nextStreamId = 1;
  private state: RealtimeStatus = "disabled";

  readonly enabled = process.env.REALTIME_DISABLED !== "true";

  get status(): RealtimeStatus {
    return this.state;
  }

  get openStreams(): number {
    return this.hub.size;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log("Realtime stream disabled (REALTIME_DISABLED=true)");
      return;
    }
    this.state = "reconnecting";
    this.heartbeat = setInterval(
      () => this.hub.sendToAll(SSE_HEARTBEAT),
      REALTIME_HEARTBEAT_MS,
    );
    this.heartbeat.unref();
    // Not awaited: a database that is briefly unreachable at boot must not
    // hold the whole service back; the listener keeps retrying on its own.
    void this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.hub.closeAll();
    await this.client?.end().catch(() => undefined);
    this.client = null;
  }

  /** Registers an open stream and tells it to read everything once. */
  open(
    userId: string,
    send: (frame: string) => void,
    close: () => void,
  ): RealtimeStream {
    const stream: RealtimeStream = {
      id: this.nextStreamId++,
      userId,
      send,
      close,
    };
    this.hub.add(stream);
    send(sseFrame({ type: "ready", topics: [...REALTIME_TOPICS] }));
    return stream;
  }

  release(stream: RealtimeStream): void {
    this.hub.remove(stream);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("notification", (message) => {
      if (message.channel !== REALTIME_CHANNEL) return;
      const signal = parseRealtimeSignal(message.payload);
      if (!signal) return;
      this.hub.sendTo(
        signal.userId,
        sseFrame({ type: "changed", topic: signal.topic }),
      );
    });
    client.on("error", (error) => {
      this.logger.warn(`Realtime listener error: ${error.message}`);
      this.scheduleReconnect(client);
    });
    client.on("end", () => this.scheduleReconnect(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    } catch (error) {
      this.logger.warn(
        `Realtime listener could not connect: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      this.scheduleReconnect(client);
      return;
    }
    const recovered = this.attempts > 0;
    this.client = client;
    this.attempts = 0;
    this.state = "listening";
    this.logger.log("Realtime listener connected");
    if (recovered) {
      this.hub.sendToAll(
        sseFrame({ type: "ready", topics: [...REALTIME_TOPICS] }),
      );
    }
  }

  private scheduleReconnect(client: Client): void {
    // `error` and `end` both arrive for one failure; only the first counts,
    // and a connection that was already replaced is ignored.
    if (this.stopped || this.reconnectTimer) return;
    if (this.client && this.client !== client) return;
    this.client = null;
    this.state = "reconnecting";
    void client.end().catch(() => undefined);
    const delay =
      RECONNECT_DELAYS_MS[
        Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)
      ];
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }
}
