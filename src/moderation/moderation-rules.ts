import {
  MODERATION_QUEUE_PAGE_SIZE,
  type ModerationActionKind,
  type ReportStatus,
  type ReportSubjectKind,
} from '@sunsteel/contracts';

/**
 * TRUST-04's pure rules. Everything here is arithmetic and vocabulary; the
 * service owns the queries and the writes. Keeping the decisions out of the
 * service is what lets a test assert them without a database, the same way
 * `activity-rules.ts` holds `SOC-03`'s.
 */

/** What a report's status becomes after one action. */
export function statusAfter(
  kind: ModerationActionKind,
  current: ReportStatus,
): ReportStatus {
  switch (kind) {
    case 'DISMISS_REPORT':
      return 'DISMISSED';
    case 'HIDE_SUBJECT':
      return 'ACTIONED';
    // Restoring reopens the report rather than closing it as handled: the
    // hide it undoes was the handling, so the row is back to needing a
    // decision. Reading changes nothing at all.
    case 'RESTORE_SUBJECT':
      return 'OPEN';
    case 'VIEW_SUBJECT':
      return current;
  }
}

/** Whether an action closes the report it was taken from. */
export function resolvesReport(kind: ModerationActionKind): boolean {
  return kind === 'DISMISS_REPORT' || kind === 'HIDE_SUBJECT';
}

/**
 * Whether a subject can still be acted on. A subject that no longer exists
 * can only be dismissed — there is nothing left to hide, and inventing a hide
 * row for it would leave an enforcement record about nothing.
 */
export function canAct(
  kind: ModerationActionKind,
  subject: { isMissing: boolean; isHidden: boolean },
): { allowed: boolean; reason?: string } {
  if (kind === 'DISMISS_REPORT') return { allowed: true };
  if (subject.isMissing) {
    return { allowed: false, reason: 'The reported content no longer exists' };
  }
  if (kind === 'HIDE_SUBJECT' && subject.isHidden) {
    return { allowed: false, reason: 'The reported content is already hidden' };
  }
  if (kind === 'RESTORE_SUBJECT' && !subject.isHidden) {
    return { allowed: false, reason: 'The reported content is not hidden' };
  }
  return { allowed: true };
}

export function clampPageSize(limit: number | undefined, max: number): number {
  if (!limit || Number.isNaN(limit) || limit < 1) return max;
  return Math.min(Math.floor(limit), max);
}

export function queuePageSize(limit: number | undefined): number {
  return clampPageSize(limit, MODERATION_QUEUE_PAGE_SIZE);
}

/**
 * The queue cursor is the last row's `createdAt` and id. Reports about one
 * subject arrive in bursts and share a second, so the id breaks the tie —
 * the same reason `SOC-03`'s cursor carries more than an instant.
 */
export interface QueueCursor {
  at: Date;
  id: string;
}

export function encodeQueueCursor(cursor: QueueCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`).toString(
    'base64url',
  );
}

export function decodeQueueCursor(raw: string | undefined): QueueCursor | null {
  if (!raw) return null;
  const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (!at || !id) return null;
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? null : { at: parsed, id };
}

/**
 * The subject a review action is recorded against. A `MEMBER` report may name
 * a username, which is not stable — an account can change it — so the record
 * always stores what the identifier resolved to at review time, and the
 * queue reports both.
 */
export interface ResolvedSubject {
  kind: ReportSubjectKind;
  /** Null when nothing with that identifier exists any more. */
  resolvedId: string | null;
  /** The account that owns it, for MEMBER the account itself. */
  ownerId: string | null;
  title: string | null;
  isHidden: boolean;
}
