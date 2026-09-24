import type { NotificationCategory, PushPayload } from '@sunsteel/contracts';
import {
  eventActivityType,
  planAllows,
  type AuthorActivityPlan,
} from '../activity/activity-rules';

export const PARTNER_ACTIVITY_NOTIFICATION_KINDS = [
  'TRAINING_PARTNER_SESSION',
  'TRAINING_PARTNER_ACHIEVEMENT',
] as const;

export type PartnerActivityNotificationKind =
  (typeof PARTNER_ACTIVITY_NOTIFICATION_KINDS)[number];

export interface PartnerAlertEvent {
  eventKey: string;
  userId: string;
  sessionId: string | null;
  type: string;
  occurredAt: Date;
  payload: unknown;
}

export interface PartnerAlertSelection {
  kind: PartnerActivityNotificationKind;
  category: Extract<
    NotificationCategory,
    'TRAINING_PARTNER_SESSION' | 'TRAINING_PARTNER_ACHIEVEMENT'
  >;
}

/** NOTIF-07 intentionally chooses two bounded facts, never each PR/load event. */
export function partnerAlertSelection(
  event: Pick<PartnerAlertEvent, 'type' | 'payload'>,
): PartnerAlertSelection | null {
  const type = eventActivityType(event);
  if (type === 'SESSION_COMPLETED') {
    return {
      kind: 'TRAINING_PARTNER_SESSION',
      category: 'TRAINING_PARTNER_SESSION',
    };
  }
  if (type === 'ACHIEVEMENT_UNLOCKED') {
    return {
      kind: 'TRAINING_PARTNER_ACHIEVEMENT',
      category: 'TRAINING_PARTNER_ACHIEVEMENT',
    };
  }
  return null;
}

export function partnerAlertIsVisible({
  event,
  plan,
  enabledAt,
}: {
  event: PartnerAlertEvent;
  plan: AuthorActivityPlan;
  enabledAt: Date | null;
}): boolean {
  const type = eventActivityType(event);
  return Boolean(
    type &&
    (type === 'SESSION_COMPLETED' || type === 'ACHIEVEMENT_UNLOCKED') &&
    enabledAt &&
    event.occurredAt >= enabledAt &&
    planAllows(plan, type, event.eventKey),
  );
}

export interface PartnerSessionFacts {
  id: string;
  routineName: string;
  dayName: string | null;
}

export function partnerAlertPayload(
  event: PartnerAlertEvent,
  session: PartnerSessionFacts | null,
): Record<string, unknown> | null {
  const selected = partnerAlertSelection(event);
  if (!selected) return null;
  if (selected.kind === 'TRAINING_PARTNER_SESSION') {
    if (!event.sessionId || !session || session.id !== event.sessionId)
      return null;
    return {
      entryId: event.eventKey,
      routineName: session.routineName,
      dayName: session.dayName,
    };
  }
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const achievementId = typeof payload.id === 'string' ? payload.id : '';
  if (!achievementId) return null;
  return {
    entryId: event.eventKey,
    achievementId,
    title: typeof payload.title === 'string' ? payload.title : 'Achievement',
  };
}

interface PartnerPushRow {
  kind: PartnerActivityNotificationKind;
  sourceKey: string;
  payload: unknown;
  actor: {
    username: string;
    name: string;
    lastName: string | null;
  } | null;
}

export function partnerActivityPushPayload(
  row: PartnerPushRow,
): PushPayload | null {
  if (!row.actor) return null;
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const name = [row.actor.name, row.actor.lastName].filter(Boolean).join(' ');
  const url = `/profile/${row.actor.username}`;
  if (row.kind === 'TRAINING_PARTNER_SESSION') {
    const routineName = String(payload.routineName ?? 'Workout');
    const dayName =
      typeof payload.dayName === 'string' ? payload.dayName : null;
    return {
      kind: row.kind,
      title: `${name} completed a workout`,
      body: dayName ? `${routineName} · ${dayName}` : routineName,
      url,
      tag: `partner-session-${row.sourceKey}`,
    };
  }
  return {
    kind: row.kind,
    title: `${name} earned an achievement`,
    body: String(payload.title ?? 'Achievement'),
    url,
    tag: `partner-achievement-${row.sourceKey}`,
  };
}
