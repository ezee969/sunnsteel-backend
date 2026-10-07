import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import type { PushPayload } from "@sunsteel/contracts";
import { DatabaseService } from "../../database/database.service";
import {
  messagePushStillDue,
  unreadCutoff,
} from "../../messages/message-rules";
import { isHiddenFromViewer } from "../../users/member-blocks";
import { PushConfigService } from "./push-config.service";
import { PushSenderService } from "./push-sender.service";

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

  /**
   * Upserts on `dedupeKey`, so re-planning replaces rather than duplicates: a
   * new rest period replaces the session's pending alert, and a second planning
   * tick for the same local date finds the reminder already there.
   */
  async schedule({
    userId,
    dedupeKey,
    sendAt,
    payload,
    sessionId,
  }: {
    userId: string;
    dedupeKey: string;
    sendAt: Date;
    payload: PushPayload;
    sessionId?: string;
  }): Promise<void> {
    const json = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
    await this.db.scheduledPush.upsert({
      where: { dedupeKey },
      create: { userId, dedupeKey, sessionId, sendAt, payload: json },
      update: { userId, sessionId, sendAt, payload: json },
    });
  }

  /** Skipping rest, finishing the set early or ending the session cancels it. */
  async cancel(userId: string, dedupeKey: string): Promise<void> {
    await this.db.scheduledPush.deleteMany({ where: { userId, dedupeKey } });
  }

  /**
   * MSG-08: a message push is asked again when it falls due -- dropped once
   * the recipient has read the other member's newest message or can no
   * longer read the conversation. The sweep then records when it went, so
   * the conversation pushes once until read.
   */
  private async messagePushStillDue(
    userId: string,
    payload: Extract<PushPayload, { kind: "MESSAGE" }>,
  ): Promise<boolean> {
    const participant = await this.db.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId: payload.conversationId,
          userId,
        },
      },
      select: {
        lastReadAt: true,
        clearedAt: true,
        conversation: {
          select: {
            status: true,
            participants: {
              where: { userId: { not: userId } },
              select: { userId: true },
            },
          },
        },
      },
    });
    const other = participant?.conversation.participants[0]?.userId;
    const newest = other
      ? await this.db.message.findFirst({
          where: {
            conversationId: payload.conversationId,
            senderId: other,
            deletedAt: null,
            moderationHiddenAt: null,
          },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : null;
    return messagePushStillDue({
      cutoff: participant
        ? unreadCutoff(participant.lastReadAt, participant.clearedAt)
        : undefined,
      newestFromThem: newest?.createdAt ?? null,
      status: participant?.conversation.status ?? null,
      hidden: other ? await isHiddenFromViewer(this.db, userId, other) : true,
    });
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
      // `sendAt` is a timestamp written as UTC, so it is compared with UTC:
      // a bare NOW() is read in the session's zone, which on a server set to
      // anything else made every push due hours early.
      const claimed = await this.db.$queryRaw<ClaimedPush[]>`
        DELETE FROM "ScheduledPush"
        WHERE "sendAt" <= (NOW() AT TIME ZONE 'UTC')
        RETURNING "id", "userId", "payload"
      `;
      if (claimed.length === 0) return;

      await Promise.all(
        claimed.map(async (row) => {
          const payload = row.payload as unknown as PushPayload;
          try {
            if (payload.kind !== "MESSAGE") {
              await this.sender.sendToUser(row.userId, payload);
              return;
            }
            if (!(await this.messagePushStillDue(row.userId, payload))) {
              return;
            }
            const result = await this.sender.sendToUser(row.userId, payload);
            // Only a push a device took counts: one the switch or the quiet
            // window held back, or none that arrived, leaves the next message
            // free to be the one that reaches them.
            if (result.sent > 0) {
              await this.db.conversationParticipant.update({
                where: {
                  conversationId_userId: {
                    conversationId: payload.conversationId,
                    userId: row.userId,
                  },
                },
                data: { lastPushedAt: new Date() },
              });
            }
          } catch (error: unknown) {
            this.logger.warn(
              `Scheduled push ${row.id} could not be delivered: ${String(error)}`,
            );
          }
        }),
      );
    } catch (error) {
      // A failed sweep must never take the process down; the next tick retries.
      this.logger.error(`Push sweep failed: ${String(error)}`);
    } finally {
      this.sweeping = false;
    }
  }
}
