import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import type { ActivityType, ProfileVisibility } from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { hiddenFromViewer } from '../users/member-blocks';
import {
  mapProfilePrivacy,
  resolveProfileViewerAccess,
} from '../users/profile-privacy';
import { readSnapshot } from '../workouts/analytics/session-snapshot';
import { routineDayName } from '../workouts/workout-session.selects';
import {
  planAuthorActivity,
  type AuthorSharingChoices,
} from '../activity/activity-rules';
import { PushSenderService } from './push/push-sender.service';
import { lookbackStart } from './notification-sources';
import {
  PARTNER_ACTIVITY_NOTIFICATION_KINDS,
  partnerActivityPushPayload,
  partnerAlertIsVisible,
  partnerAlertPayload,
  partnerAlertSelection,
  type PartnerAlertEvent,
} from './partner-activity-alerts';

export const PARTNER_ACTIVITY_SWEEP_INTERVAL_MS = 60_000;
const RECIPIENT_BATCH_SIZE = 50;

const AUTHOR_SELECT = {
  id: true,
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
  bioVisibility: true,
  locationVisibility: true,
  trainingIdentityVisibility: true,
  historyVisibility: true,
  recordsVisibility: true,
  routinesVisibility: true,
  achievementsVisibility: true,
  bodyMetricsVisibility: true,
} as const;

const SESSION_SELECT = {
  id: true,
  snapshot: { select: { payload: true } },
  routine: { select: { name: true } },
  routineDay: { select: { dayOfWeek: true, name: true, order: true } },
} as const;

type RecipientPreferences = {
  id: string;
  notifyPartnerSession: boolean;
  notifyPartnerAchievement: boolean;
  partnerSessionAlertsEnabledAt: Date | null;
  partnerAchievementAlertsEnabledAt: Date | null;
};

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const enabledSince = (value: Date | null, lookback: Date): Date | null =>
  value && value > lookback ? value : value ? lookback : null;

/**
 * NOTIF-07. Training events are the durable source, Notification is the
 * recipient-specific dedupe/centre row, and pushProcessedAt is its one-shot
 * delivery claim. The source is re-authorized before every read/delivery so a
 * withdrawn grant, audience, partnership or block revokes the visible row
 * without clearing that one-shot claim.
 */
@Injectable()
export class PartnerActivityAlertsService {
  private readonly logger = new Logger(PartnerActivityAlertsService.name);
  private sweeping = false;
  private recipientCursor: string | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly sender: PushSenderService,
  ) {}

  @Interval(PARTNER_ACTIVITY_SWEEP_INTERVAL_MS)
  async sweep(now = new Date()): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const recipients = await this.db.user.findMany({
        where: {
          OR: [
            {
              notifyPartnerSession: true,
              partnerSessionAlertsEnabledAt: { not: null },
            },
            {
              notifyPartnerAchievement: true,
              partnerAchievementAlertsEnabledAt: { not: null },
            },
          ],
          ...(this.recipientCursor ? { id: { gt: this.recipientCursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: RECIPIENT_BATCH_SIZE,
        select: {
          id: true,
          notifyPartnerSession: true,
          notifyPartnerAchievement: true,
          partnerSessionAlertsEnabledAt: true,
          partnerAchievementAlertsEnabledAt: true,
        },
      });
      for (const recipient of recipients) {
        await this.syncRecipient(recipient, now);
      }
      this.recipientCursor =
        recipients.length === RECIPIENT_BATCH_SIZE
          ? recipients[recipients.length - 1].id
          : null;
    } catch (error) {
      this.logger.error(`Partner activity sweep failed: ${String(error)}`);
    } finally {
      this.sweeping = false;
    }
  }

  /** Used by GET /notifications as a catch-up path as well as by the sweep. */
  async syncUser(userId: string, now = new Date()): Promise<void> {
    const recipient = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        notifyPartnerSession: true,
        notifyPartnerAchievement: true,
        partnerSessionAlertsEnabledAt: true,
        partnerAchievementAlertsEnabledAt: true,
      },
    });
    if (!recipient) return;
    await this.syncRecipient(recipient, now);
  }

  private async syncRecipient(
    recipient: RecipientPreferences,
    now: Date,
  ): Promise<void> {
    const sessionSince = recipient.notifyPartnerSession
      ? enabledSince(
          recipient.partnerSessionAlertsEnabledAt,
          lookbackStart(now),
        )
      : null;
    const achievementSince = recipient.notifyPartnerAchievement
      ? enabledSince(
          recipient.partnerAchievementAlertsEnabledAt,
          lookbackStart(now),
        )
      : null;
    if (!sessionSince && !achievementSince) {
      await this.revokeAll(recipient.id, now);
      return;
    }

    const grants = await this.db.trainingPartnerGrant.findMany({
      where: {
        activity: true,
        grantorId: { not: recipient.id },
        partnership: {
          status: 'ACTIVE',
          OR: [{ requesterId: recipient.id }, { recipientId: recipient.id }],
        },
      },
      select: { grantorId: true },
    });
    const hidden = new Set(await hiddenFromViewer(this.db, recipient.id));
    const actorIds = [
      ...new Set(
        grants
          .map((grant) => grant.grantorId)
          .filter((actorId) => !hidden.has(actorId)),
      ),
    ];
    if (actorIds.length === 0) {
      await this.revokeAll(recipient.id, now);
      return;
    }

    const [actors, defaults, overrides, events] = await Promise.all([
      this.db.user.findMany({
        where: { id: { in: actorIds }, moderationHiddenAt: null },
        select: AUTHOR_SELECT,
      }),
      this.db.activitySharingDefault.findMany({
        where: { userId: { in: actorIds } },
        select: { userId: true, type: true, audience: true },
      }),
      this.db.activityEntryOverride.findMany({
        where: { userId: { in: actorIds } },
        select: { userId: true, entryKey: true, type: true, audience: true },
      }),
      this.db.trainingEvent.findMany({
        where: {
          userId: { in: actorIds },
          occurredAt: { lte: now },
          OR: [
            ...(sessionSince
              ? [
                  {
                    type: 'SESSION_COMPLETED' as const,
                    occurredAt: { gte: sessionSince },
                  },
                ]
              : []),
            ...(achievementSince
              ? [
                  {
                    type: 'ACHIEVEMENT_UNLOCKED' as const,
                    occurredAt: { gte: achievementSince },
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: {
          eventKey: true,
          userId: true,
          sessionId: true,
          type: true,
          occurredAt: true,
          payload: true,
        },
      }),
    ]);

    const plans = new Map(
      actors.map((actor) => {
        const choices: AuthorSharingChoices = {
          defaults: Object.fromEntries(
            defaults
              .filter((item) => item.userId === actor.id)
              .map((item) => [item.type, item.audience]),
          ) as Partial<Record<ActivityType, ProfileVisibility>>,
          overrides: new Map(
            overrides
              .filter((item) => item.userId === actor.id)
              .map((item) => [
                item.entryKey,
                { type: item.type, audience: item.audience },
              ]),
          ),
        };
        const context = { isOwner: false, isFollower: true };
        const access = resolveProfileViewerAccess(
          mapProfilePrivacy(actor),
          context,
        );
        return [
          actor.id,
          planAuthorActivity(access, choices, context),
        ] as const;
      }),
    );
    const eligible = (events as PartnerAlertEvent[]).filter((event) => {
      const selected = partnerAlertSelection(event);
      const plan = plans.get(event.userId);
      if (!selected || !plan) return false;
      return partnerAlertIsVisible({
        event,
        plan,
        enabledAt:
          selected.kind === 'TRAINING_PARTNER_SESSION'
            ? sessionSince
            : achievementSince,
      });
    });

    const sessionIds = eligible.flatMap((event) =>
      event.type === 'SESSION_COMPLETED' && event.sessionId
        ? [event.sessionId]
        : [],
    );
    const sessions = sessionIds.length
      ? await this.db.workoutSession.findMany({
          where: {
            id: { in: sessionIds },
            userId: { in: actorIds },
            status: 'COMPLETED',
          },
          select: SESSION_SELECT,
        })
      : [];
    const sessionFacts = new Map(
      sessions.map((session) => {
        const snapshot = session.snapshot
          ? readSnapshot(session.snapshot.payload)
          : null;
        return [
          session.id,
          {
            id: session.id,
            routineName:
              snapshot?.routine.name ?? session.routine?.name ?? 'Workout',
            dayName: routineDayName(snapshot?.routineDay ?? session.routineDay),
          },
        ] as const;
      }),
    );
    const drafts = eligible.flatMap((event) => {
      const selected = partnerAlertSelection(event)!;
      const payload = partnerAlertPayload(
        event,
        event.sessionId ? (sessionFacts.get(event.sessionId) ?? null) : null,
      );
      if (!payload) return [];
      return [
        {
          userId: recipient.id,
          kind: selected.kind,
          sourceKey: `partner:${event.eventKey}`,
          actorId: event.userId,
          sessionId:
            selected.kind === 'TRAINING_PARTNER_SESSION'
              ? event.sessionId
              : null,
          payload: json(payload),
          createdAt: event.occurredAt,
        },
      ];
    });
    const eligibleKeys = drafts.map((draft) => draft.sourceKey);
    await this.db.$transaction([
      this.db.notification.updateMany({
        where: {
          userId: recipient.id,
          kind: { in: [...PARTNER_ACTIVITY_NOTIFICATION_KINDS] },
          ...(eligibleKeys.length
            ? { sourceKey: { notIn: eligibleKeys } }
            : {}),
        },
        data: { revokedAt: now },
      }),
      ...(drafts.length
        ? [
            this.db.notification.createMany({
              data: drafts,
              skipDuplicates: true,
            }),
            this.db.notification.updateMany({
              where: {
                userId: recipient.id,
                kind: { in: [...PARTNER_ACTIVITY_NOTIFICATION_KINDS] },
                sourceKey: { in: eligibleKeys },
              },
              data: { revokedAt: null },
            }),
          ]
        : []),
    ]);
    await this.deliverPending(recipient.id, now);
  }

  private async deliverPending(userId: string, now: Date): Promise<void> {
    const claimed = await this.db.$queryRaw<{ id: string }[]>`
      UPDATE "Notification"
      SET "pushProcessedAt" = timezone('UTC', ${now})
      WHERE "id" IN (
        SELECT "id"
        FROM "Notification"
        WHERE "userId" = ${userId}
          AND "kind" IN (
            'TRAINING_PARTNER_SESSION'::"NotificationKind",
            'TRAINING_PARTNER_ACHIEVEMENT'::"NotificationKind"
          )
          AND "pushProcessedAt" IS NULL
          AND "revokedAt" IS NULL
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 50
      )
      RETURNING "id"
    `;
    if (claimed.length === 0) return;
    const rows = await this.db.notification.findMany({
      where: { id: { in: claimed.map((row) => row.id) }, userId },
      select: {
        id: true,
        kind: true,
        sourceKey: true,
        payload: true,
        actor: { select: { username: true, name: true, lastName: true } },
      },
    });
    await Promise.all(
      rows.map(async (row) => {
        if (
          !PARTNER_ACTIVITY_NOTIFICATION_KINDS.includes(
            row.kind as (typeof PARTNER_ACTIVITY_NOTIFICATION_KINDS)[number],
          )
        ) {
          return;
        }
        const payload = partnerActivityPushPayload({
          ...row,
          kind: row.kind as (typeof PARTNER_ACTIVITY_NOTIFICATION_KINDS)[number],
        });
        if (!payload) return;
        await this.sender.sendToUser(userId, payload);
      }),
    );
  }

  private async revokeAll(userId: string, now: Date): Promise<void> {
    await this.db.notification.updateMany({
      where: {
        userId,
        kind: { in: [...PARTNER_ACTIVITY_NOTIFICATION_KINDS] },
      },
      data: { revokedAt: now },
    });
  }
}
