import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import type { PushPayload } from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { PushConfigService } from './push-config.service';
import { PushSenderService } from './push-sender.service';

/**
 * How often due alerts are swept. A rest alert is only useful within a few
 * seconds of the deadline, so this is the resolution the feature promises —
 * and why `REST_ALERT_MIN_LEAD_SECONDS` refuses anything closer.
 */
export const PUSH_SWEEP_INTERVAL_MS = 5_000;

interface ClaimedPush {
  id: string;
  userId: string;
  payload: Prisma.JsonValue;
}

/**
 * NOTIF-03's delivery half. A pending alert is a row, not a timer in memory,
 * so a restart or a deploy between logging a set and the end of rest still
 * delivers it.
 */
@Injectable()
export class ScheduledPushService {
  private readonly logger = new Logger(ScheduledPushService.name);
  /** A slow send must not let the next tick claim and resend the same rows. */
  private sweeping = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly sender: PushSenderService,
    private readonly config: PushConfigService,
  ) {}

  /** Replaces this session's pending alert, so a session holds at most one. */
  async schedule(
    userId: string,
    sessionId: string,
    sendAt: Date,
    payload: PushPayload,
  ): Promise<void> {
    const json = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
    await this.db.scheduledPush.upsert({
      where: { sessionId },
      create: { userId, sessionId, sendAt, payload: json },
      update: { userId, sendAt, payload: json },
    });
  }

  /** Skipping rest, finishing the set early or ending the session cancels it. */
  async cancel(userId: string, sessionId: string): Promise<void> {
    await this.db.scheduledPush.deleteMany({ where: { userId, sessionId } });
  }

  @Interval(PUSH_SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    if (this.sweeping || !this.config.isConfigured) return;
    this.sweeping = true;
    try {
      // Claiming is the delete itself: `DELETE ... RETURNING` is atomic, so two
      // instances sweeping at once cannot both take the same row and send the
      // alert twice. A crash after claiming loses one alert; sending twice
      // would wake the athlete mid-set, which is the worse failure.
      const claimed = await this.db.$queryRaw<ClaimedPush[]>`
        DELETE FROM "ScheduledPush"
        WHERE "sendAt" <= NOW()
        RETURNING "id", "userId", "payload"
      `;
      if (claimed.length === 0) return;

      await Promise.all(
        claimed.map((row) =>
          this.sender
            .sendToUser(row.userId, row.payload as unknown as PushPayload)
            .catch((error: unknown) => {
              this.logger.warn(
                `Scheduled push ${row.id} could not be delivered: ${String(error)}`,
              );
            }),
        ),
      );
    } catch (error) {
      // A failed sweep must never take the process down; the next tick retries.
      this.logger.error(`Push sweep failed: ${String(error)}`);
    } finally {
      this.sweeping = false;
    }
  }
}
