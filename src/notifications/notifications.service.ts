import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NOTIFICATIONS_LIST_LIMIT,
  TRAINING_PARTNER_ENCOURAGEMENT_KINDS,
  type AppNotification,
  type MarkNotificationsReadResponse,
  type NotificationsResponse,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { readSnapshot } from '../workouts/analytics/session-snapshot';
import { routineDayName } from '../workouts/workout-session.selects';
import {
  NOTIFICATION_EVENT_TYPES,
  gatherNotifications,
  lookbackStart,
  retentionStart,
} from './notification-sources';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const NOTIFICATION_SELECT = {
  id: true,
  kind: true,
  payload: true,
  createdAt: true,
  readAt: true,
  sessionId: true,
  actor: {
    select: {
      id: true,
      username: true,
      name: true,
      lastName: true,
      avatarUrl: true,
    },
  },
} as const;

type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof NOTIFICATION_SELECT;
}>;

const SESSION_NAME_SELECT = {
  id: true,
  status: true,
  endedAt: true,
  snapshot: { select: { payload: true } },
  routine: { select: { name: true } },
  routineDay: { select: { dayOfWeek: true, name: true, order: true } },
} as const;

export function toAppNotification(
  row: NotificationRow,
  followedIds: ReadonlySet<string>,
): AppNotification | null {
  const base = {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  switch (row.kind) {
    case 'ACHIEVEMENT':
      return {
        ...base,
        kind: 'ACHIEVEMENT',
        achievement: {
          id: String(payload.achievementId ?? ''),
          title: String(payload.title ?? ''),
          description: String(payload.description ?? ''),
        },
      };
    case 'SESSION_PROGRESS':
      if (!row.sessionId) return null;
      return {
        ...base,
        kind: 'SESSION_PROGRESS',
        session: {
          id: row.sessionId,
          routineName: String(payload.routineName ?? ''),
          dayName: typeof payload.dayName === 'string' ? payload.dayName : null,
          recordCount: Number(payload.recordCount ?? 0),
          progressionCount: Number(payload.progressionCount ?? 0),
        },
      };
    case 'NEW_FOLLOWER':
      if (!row.actor) return null;
      return {
        ...base,
        kind: 'NEW_FOLLOWER',
        actor: {
          ...row.actor,
          isFollowedByMe: followedIds.has(row.actor.id),
        },
      };
    case 'ACTIVITY_COMMENT': {
      // SOC-06. No `isFollowedByMe`: a comment is not an invitation to follow
      // anyone, and the row carries no body, because it outlives the comment
      // it announces.
      const entryId = typeof payload.entryId === 'string' ? payload.entryId : '';
      if (!row.actor || !entryId) return null;
      return { ...base, kind: 'ACTIVITY_COMMENT', actor: row.actor, entryId };
    }
    case 'TRAINING_PARTNER_ENCOURAGEMENT': {
      const encouragementKind = payload.encouragementKind;
      if (
        !row.actor ||
        typeof encouragementKind !== 'string' ||
        !TRAINING_PARTNER_ENCOURAGEMENT_KINDS.includes(
          encouragementKind as (typeof TRAINING_PARTNER_ENCOURAGEMENT_KINDS)[number],
        )
      ) {
        return null;
      }
      return {
        ...base,
        kind: 'TRAINING_PARTNER_ENCOURAGEMENT',
        actor: row.actor,
        encouragement: {
          kind: encouragementKind as (typeof TRAINING_PARTNER_ENCOURAGEMENT_KINDS)[number],
        },
      };
    }
    default:
      return null;
  }
}

/**
 * NOTIF-01: the in-app notification center. Reading the list first gathers
 * new notifications from training events, follows and SOC-06 comments of the last
 * `NOTIFICATIONS_LOOKBACK_DAYS` (idempotent, keyed by source) and drops those
 * past `NOTIFICATIONS_RETENTION_DAYS`, so no write path elsewhere needs to
 * know notifications exist.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId: string, now = new Date()): Promise<NotificationsResponse> {
    await this.gather(userId, now);
    const [rows, unreadCount] = await Promise.all([
      this.db.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: NOTIFICATIONS_LIST_LIMIT,
        select: NOTIFICATION_SELECT,
      }),
      this.unreadCount(userId),
    ]);
    const actorIds = rows.flatMap((row) => (row.actor ? [row.actor.id] : []));
    const followed = actorIds.length
      ? await this.db.userFollow.findMany({
          where: { followerId: userId, followingId: { in: actorIds } },
          select: { followingId: true },
        })
      : [];
    const followedIds = new Set(followed.map((row) => row.followingId));
    return {
      notifications: rows.flatMap((row) => {
        const notification = toAppNotification(row, followedIds);
        return notification ? [notification] : [];
      }),
      unreadCount,
    };
  }

  /** Marks the given notifications read, or every one without ids. */
  async markRead(
    userId: string,
    ids: string[] | undefined,
    now = new Date(),
  ): Promise<MarkNotificationsReadResponse> {
    await this.db.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: now },
    });
    return { unreadCount: await this.unreadCount(userId) };
  }

  private unreadCount(userId: string) {
    return this.db.notification.count({ where: { userId, readAt: null } });
  }

  private async gather(userId: string, now: Date) {
    const since = lookbackStart(now);
    const [events, follows, comments] = await Promise.all([
      this.db.trainingEvent.findMany({
        where: {
          userId,
          occurredAt: { gte: since },
          type: { in: [...NOTIFICATION_EVENT_TYPES] },
        },
        select: { type: true, sessionId: true, occurredAt: true, payload: true },
      }),
      this.db.userFollow.findMany({
        where: { followingId: userId, createdAt: { gte: since } },
        select: { followerId: true, createdAt: true },
      }),
      // SOC-06: comments on this member's own activity. A comment they wrote
      // themselves is not news, and a comment a moderator hid is announced to
      // nobody -- the notification would be the one place it stayed visible.
      this.db.activityComment.findMany({
        where: {
          authorId: userId,
          userId: { not: userId },
          moderationHiddenAt: null,
          createdAt: { gte: since },
        },
        select: {
          id: true,
          entryKey: true,
          userId: true,
          createdAt: true,
        },
      }),
    ]);
    const sessionIds = [
      ...new Set(
        events.flatMap((event) =>
          event.type !== 'ACHIEVEMENT_UNLOCKED' && event.sessionId
            ? [event.sessionId]
            : [],
        ),
      ),
    ];
    const sessions = sessionIds.length
      ? await this.db.workoutSession.findMany({
          where: { userId, id: { in: sessionIds } },
          select: SESSION_NAME_SELECT,
        })
      : [];
    const drafts = gatherNotifications({
      events,
      follows,
      comments,
      sessions: sessions.map((session) => {
        const snapshot = session.snapshot
          ? readSnapshot(session.snapshot.payload)
          : null;
        return {
          id: session.id,
          status: session.status,
          endedAt: session.endedAt,
          routineName:
            snapshot?.routine.name ?? session.routine?.name ?? 'Workout',
          dayName: routineDayName(snapshot?.routineDay ?? session.routineDay),
        };
      }),
    });
    await Promise.all([
      drafts.length
        ? this.db.notification.createMany({
            data: drafts.map((draft) => ({
              ...draft,
              userId,
              payload: json(draft.payload),
            })),
            skipDuplicates: true,
          })
        : null,
      this.db.notification.deleteMany({
        where: { userId, createdAt: { lt: retentionStart(now) } },
      }),
    ]);
  }
}
