import { Controller, Get, Req, Res, UseGuards } from "@nestjs/common";
import { REALTIME_UNAVAILABLE_RETRY_SECONDS } from "@sunsteel/contracts";
import type { Response } from "express";
import { SupabaseJwtGuard } from "../auth/guards/supabase-jwt.guard";
import type { RequestWithUser } from "../common/types/request-with-user";
import { bearerExpirySeconds, streamLifetimeMs } from "./realtime-rules";
import { RealtimeService } from "./realtime.service";

/**
 * MSG-06: the signed-in member's change signals as Server-Sent Events.
 *
 * The browser reads it with `fetch` rather than `EventSource`, which cannot
 * send the bearer token, and a token never goes in the URL. The stream ends
 * when its token expires or after `REALTIME_MAX_STREAM_MS`, and the client
 * reconnects with a fresh one, so the guard on the opening request is the
 * only authorization a stream ever needs.
 */
@UseGuards(SupabaseJwtGuard)
@Controller("realtime")
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get("stream")
  stream(@Req() req: RequestWithUser, @Res() res: Response): void {
    if (!this.realtime.enabled) {
      res
        .status(503)
        .set("Retry-After", String(REALTIME_UNAVAILABLE_RETRY_SECONDS))
        .set("Cache-Control", "no-store")
        .end();
      return;
    }

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Proxies that buffer responses would hold every signal back.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    req.socket.setNoDelay(true);

    const lifetime = setTimeout(
      () => end(),
      streamLifetimeMs(
        Date.now(),
        bearerExpirySeconds(req.headers.authorization),
      ),
    );
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(lifetime);
      this.realtime.release(stream);
      res.end();
    };
    const stream = this.realtime.open(
      req.user.id,
      (frame) => {
        if (!ended) res.write(frame);
      },
      end,
    );
    req.on("close", end);
  }
}
