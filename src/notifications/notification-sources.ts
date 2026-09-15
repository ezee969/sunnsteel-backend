import {
  NOTIFICATIONS_LOOKBACK_DAYS,
  NOTIFICATIONS_RETENTION_DAYS,
  type NotificationKind,
} from '@sunsteel/contracts';

const DAY_MS = 86_400_000;

/** The training events a notification can come from. */
export const NOTIFICATION_EVENT_TYPES = [
  'ACHIEVEMENT_UNLOCKED',
  'PERSONAL_RECORD',
  'PROGRESSION_CHANGED',
] as const;

export interface SourceEvent {
  type: string;
  sessionId: string | null;
  occurredAt: Date;
  payload: unknown;
}

export interface SourceFollow {
  followerId: string;
  createdAt: Date;
}

export interface SourceSession {
  id: string;
  status: string;
  endedAt: Date | null;
  routineName: string;
  dayName: string | null;
}

export interface NotificationDraft {
  kind: NotificationKind;
  /** Unique per recipient, so gathering again never duplicates one. */
  sourceKey: string;
  createdAt: Date;
  actorId: string | null;
  sessionId: string | null;
  payload: Record<string, unknown>;
}

export const lookbackStart = (now: Date) =>
  new Date(now.getTime() - NOTIFICATIONS_LOOKBACK_DAYS * DAY_MS);

export const retentionStart = (now: Date) =>
  new Date(now.getTime() - NOTIFICATIONS_RETENTION_DAYS * DAY_MS);

/**
 * NOTIF-01: turns records that already exist into notifications. An
 * achievement counts only when it was earned live: one recognized from
 * history never announces itself. A finished session with new records or
 * load changes becomes one note, never one per exercise, and a session still
 * in progress waits until it ends. Every follow is its own note, keyed by
 * its time, so following again after an unfollow is announced again.
 */
export function gatherNotifications({
  events,
  follows,
  sessions,
}: {
  events: SourceEvent[];
  follows: SourceFollow[];
  sessions: SourceSession[];
}): NotificationDraft[] {
  const drafts: NotificationDraft[] = [];
  const progress = new Map<string, { records: number; progressions: number }>();

  for (const event of events) {
    if (event.type === 'ACHIEVEMENT_UNLOCKED') {
      const achievement = event.payload as {
        id?: string;
        title?: string;
        description?: string;
        backfilled?: boolean;
      };
      if (achievement.backfilled !== false || !achievement.id) continue;
      drafts.push({
        kind: 'ACHIEVEMENT',
        sourceKey: `achievement:${achievement.id}`,
        createdAt: event.occurredAt,
        actorId: null,
        sessionId: null,
        payload: {
          achievementId: achievement.id,
          title: achievement.title ?? '',
          description: achievement.description ?? '',
        },
      });
      continue;
    }
    if (!event.sessionId) continue;
    const counts = progress.get(event.sessionId) ?? {
      records: 0,
      progressions: 0,
    };
    if (event.type === 'PERSONAL_RECORD') counts.records += 1;
    else if (event.type === 'PROGRESSION_CHANGED') counts.progressions += 1;
    else continue;
    progress.set(event.sessionId, counts);
  }

  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const [sessionId, counts] of progress) {
    const session = byId.get(sessionId);
    if (!session || session.status === 'IN_PROGRESS' || !session.endedAt) {
      continue;
    }
    drafts.push({
      kind: 'SESSION_PROGRESS',
      sourceKey: `session:${sessionId}`,
      createdAt: session.endedAt,
      actorId: null,
      sessionId,
      payload: {
        routineName: session.routineName,
        dayName: session.dayName,
        recordCount: counts.records,
        progressionCount: counts.progressions,
      },
    });
  }

  for (const follow of follows) {
    drafts.push({
      kind: 'NEW_FOLLOWER',
      sourceKey: `follow:${follow.followerId}:${follow.createdAt.getTime()}`,
      createdAt: follow.createdAt,
      actorId: follow.followerId,
      sessionId: null,
      payload: {},
    });
  }
  return drafts;
}
