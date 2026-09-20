import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  ACHIEVEMENT_DEFINITIONS,
  ACTIVITY_DEFAULT_AUDIENCE,
  ACTIVITY_REACTIONS,
  ACTIVITY_TYPE_SECTIONS,
  ACTIVITY_TYPES,
  type ActivityAudience,
  type ActivityCap,
  type ActivityEntry,
  type ActivityEntrySharing,
  type ActivityLink,
  type ActivityReaction,
  type ActivityReactionSummary,
  type ActivityType,
  type ComebackRecognition,
  type ProfilePrivacySettings,
  type ProfileViewerAccess,
  type ProfileVisibility,
  type ProgressionSetChange,
  type RoutineVisibility,
  type SharedRoutineOwner,
} from '@sunsteel/contracts';
import { effectiveRoutineVisibility } from '../routines/routine-visibility';
import { canViewProfileSection } from '../users/profile-privacy';

/**
 * SOC-03/SOC-04. The rules an activity read applies, kept pure so the whole
 * decision -- which entries a viewer may see, what they are called and where
 * they lead -- is testable without a database.
 */

export interface ActivityViewerContext {
  isOwner: boolean;
  isFollower: boolean;
}

/** The training events an entry can come from. `COMEBACK` and `ROUTINE_SHARED` are not events. */
export const EVENT_ACTIVITY_TYPES = [
  'SESSION_COMPLETED',
  'PERSONAL_RECORD',
  'PROGRESSION_CHANGED',
  'ACHIEVEMENT_UNLOCKED',
  'STREAK_MILESTONE',
] as const satisfies readonly ActivityType[];
export type EventActivityType = (typeof EVENT_ACTIVITY_TYPES)[number];

const isEventActivityType = (type: string): type is EventActivityType =>
  (EVENT_ACTIVITY_TYPES as readonly string[]).includes(type);

const AUDIENCE_RANK: Record<ProfileVisibility, number> = {
  PRIVATE: 0,
  FOLLOWERS: 1,
  PUBLIC: 2,
};

export const narrowerAudience = (
  a: ProfileVisibility,
  b: ProfileVisibility,
): ProfileVisibility => (AUDIENCE_RANK[a] <= AUDIENCE_RANK[b] ? a : b);

/**
 * Whether one entry may be seen by one viewer. **The section is the upper
 * bound**, decided by the shipped `PROF-06` resolver, and the entry's own
 * audience can only narrow it -- the shape `canViewRoutine` already has, so a
 * private records section can never produce a public record entry. A shared
 * routine must also pass `canViewRoutine`, which its caller checks.
 */
export function canViewActivity(
  access: ProfileViewerAccess,
  type: ActivityType,
  audience: ActivityAudience,
  context: ActivityViewerContext,
): boolean {
  return (
    access[ACTIVITY_TYPE_SECTIONS[type]] &&
    canViewProfileSection(audience, context)
  );
}

/**
 * Which of a training event's rows produce an entry, and as what type.
 *
 * A streak milestone is written twice, as `STREAK_MILESTONE` and as a
 * `STREAK_DAYS` achievement; it is reported once, as the streak. Anything
 * recognized from history (`backfilled`) never produces an entry, exactly as
 * `NOTIF-01` decided, because it has no honest date.
 */
export function eventActivityType(event: {
  type: string;
  payload: unknown;
}): EventActivityType | null {
  if (!isEventActivityType(event.type)) return null;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (
    event.type === 'ACHIEVEMENT_UNLOCKED' ||
    event.type === 'STREAK_MILESTONE'
  ) {
    if (payload.backfilled !== false) return null;
  }
  if (
    event.type === 'ACHIEVEMENT_UNLOCKED' &&
    payload.category === 'STREAK_DAYS'
  ) {
    return null;
  }
  return event.type;
}

/** The owner's stored choices for one author. */
export interface AuthorSharingChoices {
  defaults: Partial<Record<ActivityType, ActivityAudience>>;
  /** Entry key → its own audience. */
  overrides: Map<string, { type: ActivityType; audience: ActivityAudience }>;
}

export const defaultAudienceFor = (
  choices: AuthorSharingChoices,
  type: ActivityType,
): ActivityAudience => choices.defaults[type] ?? ACTIVITY_DEFAULT_AUDIENCE;

export const audienceFor = (
  choices: AuthorSharingChoices,
  type: ActivityType,
  entryKey: string,
): ActivityAudience =>
  choices.overrides.get(entryKey)?.audience ?? defaultAudienceFor(choices, type);

/**
 * What one viewer may see of one author, as three sets a query can use:
 * the types visible by default, the entries an override widened into view
 * and the entries an override narrowed out of it. Each is decided by
 * `canViewActivity`, so the query and the rule cannot disagree.
 */
export interface AuthorActivityPlan {
  visibleTypes: Set<ActivityType>;
  include: Map<string, ActivityType>;
  exclude: Set<string>;
}

export function planAuthorActivity(
  access: ProfileViewerAccess,
  choices: AuthorSharingChoices,
  context: ActivityViewerContext,
): AuthorActivityPlan {
  const visibleTypes = new Set<ActivityType>(
    ACTIVITY_TYPES.filter((type) =>
      canViewActivity(access, type, defaultAudienceFor(choices, type), context),
    ),
  );
  const include = new Map<string, ActivityType>();
  const exclude = new Set<string>();
  for (const [key, override] of choices.overrides) {
    const visible = canViewActivity(
      access,
      override.type,
      override.audience,
      context,
    );
    const byDefault = visibleTypes.has(override.type);
    if (visible && !byDefault) include.set(key, override.type);
    if (!visible && byDefault) exclude.add(key);
  }
  return { visibleTypes, include, exclude };
}

export const isPlanEmpty = (plan: AuthorActivityPlan) =>
  plan.visibleTypes.size === 0 && plan.include.size === 0;

/** Whether an entry of this type and key is in the plan. */
export const planAllows = (
  plan: AuthorActivityPlan,
  type: ActivityType,
  entryKey: string,
) =>
  plan.include.get(entryKey) === type ||
  (plan.visibleTypes.has(type) && !plan.exclude.has(entryKey));

/**
 * How one of the owner's entries is shared: the narrowest of the section
 * rule, the audience chosen and, for a shared routine, the routine's own
 * visibility -- and which of them did the narrowing, so the owner is told
 * rather than left to believe the wider choice took effect.
 */
export function entrySharing(input: {
  type: ActivityType;
  privacy: ProfilePrivacySettings;
  defaultAudience: ActivityAudience;
  override: ActivityAudience | null;
  routineVisibility?: RoutineVisibility;
}): ActivityEntrySharing {
  const section = ACTIVITY_TYPE_SECTIONS[input.type];
  const sectionRule = input.privacy[section];
  const chosen = input.override ?? input.defaultAudience;
  let effectiveAudience = narrowerAudience(sectionRule, chosen);
  let cappedBy: ActivityCap | null =
    effectiveAudience !== chosen ? 'SECTION' : null;
  if (input.routineVisibility) {
    const routine = effectiveRoutineVisibility(
      sectionRule,
      input.routineVisibility,
    );
    if (AUDIENCE_RANK[routine] < AUDIENCE_RANK[effectiveAudience]) {
      effectiveAudience = routine;
      cappedBy = 'ROUTINE';
    }
  }
  return {
    section,
    sectionRule,
    defaultAudience: input.defaultAudience,
    override: input.override,
    effectiveAudience,
    cappedBy,
  };
}

// Entries ---------------------------------------------------------------------

/** A training event as the activity read selects it. */
export interface ActivityEventRow {
  id: string;
  eventKey: string;
  userId: string;
  sessionId: string | null;
  type: string;
  occurredAt: Date;
  payload: unknown;
}

/** What the read knows about the session an event belongs to. */
export interface ActivitySessionFacts {
  routineName: string;
  dayName: string | null;
  durationSec: number | null;
}

export interface EntryContext {
  author: SharedRoutineOwner;
  /** Whether the viewer is the author: their own pages are always theirs. */
  isOwner: boolean;
  session?: ActivitySessionFacts;
  /** For a record seen by someone else: whether it is still the one the profile shows. */
  recordIsCurrent?: boolean;
}

const groupKeyFor = (sessionId: string | null) =>
  sessionId ? `session:${sessionId}` : null;

/**
 * SOC-05. Builders attach this, and the read replaces it with the page's real
 * summaries: an entry always carries the shape, so a surface can never render
 * a reaction control that has no counts behind it.
 */
export const emptyReactionSummary = (): ActivityReactionSummary => ({
  counts: Object.fromEntries(
    ACTIVITY_REACTIONS.map((reaction) => [reaction, 0]),
  ) as ActivityReactionSummary['counts'],
  viewerReaction: null,
});

/**
 * One entry's reactions as this viewer may see them. The caller passes only
 * rows it is allowed to count -- both sides of a block are filtered out before
 * this, so a number can never reveal a member the viewer blocked -- and the
 * viewer's own choice is reported so the control can show it. No list of who
 * reacted is produced: that is an identity surface of its own.
 */
export function summarizeReactions(
  rows: { userId: string; reaction: ActivityReaction }[],
  viewerId: string,
): ActivityReactionSummary {
  const summary = emptyReactionSummary();
  for (const row of rows) {
    summary.counts[row.reaction] += 1;
    if (row.userId === viewerId) summary.viewerReaction = row.reaction;
  }
  return summary;
}

/** Choosing the reaction already chosen removes it, so there is one per entry. */
export const nextReaction = (
  current: ActivityReaction | null,
  chosen: ActivityReaction | null,
): ActivityReaction | null => (chosen === null || chosen === current ? null : chosen);

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const str = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

/**
 * Where the viewer may open the record an entry came from. Somebody else's
 * session and load progression have no page another member may read, so
 * they are named and never linked; a record is linked only while it is still
 * the best the profile shows, because the profile shows current records only.
 */
export function activityLink(
  type: ActivityType,
  context: {
    isOwner: boolean;
    username: string;
    sessionId?: string | null;
    sessionExists?: boolean;
    exerciseId?: string;
    routineId?: string;
    recordIsCurrent?: boolean;
  },
): ActivityLink | null {
  switch (type) {
    case 'SESSION_COMPLETED':
      return context.isOwner && context.sessionId && context.sessionExists
        ? { kind: 'OWN_SESSION', sessionId: context.sessionId }
        : null;
    case 'PERSONAL_RECORD':
      if (context.isOwner && context.exerciseId)
        return { kind: 'OWN_EXERCISE', exerciseId: context.exerciseId };
      return context.recordIsCurrent
        ? { kind: 'MEMBER_RECORDS', username: context.username }
        : null;
    case 'PROGRESSION_CHANGED':
      return context.isOwner && context.exerciseId
        ? { kind: 'OWN_EXERCISE', exerciseId: context.exerciseId }
        : null;
    case 'ACHIEVEMENT_UNLOCKED':
    case 'STREAK_MILESTONE':
    case 'COMEBACK':
      return context.isOwner
        ? { kind: 'OWN_ACHIEVEMENTS' }
        : { kind: 'MEMBER_ACHIEVEMENTS', username: context.username };
    case 'ROUTINE_SHARED':
      if (!context.routineId) return null;
      return context.isOwner
        ? { kind: 'OWN_ROUTINE', routineId: context.routineId }
        : {
            kind: 'MEMBER_ROUTINE',
            username: context.username,
            routineId: context.routineId,
          };
  }
}

/** One training event as an entry, or null when it produces none. */
export function eventToEntry(
  event: ActivityEventRow,
  context: EntryContext,
): ActivityEntry | null {
  const type = eventActivityType(event);
  if (!type) return null;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const base = {
    id: event.eventKey,
    occurredAt: event.occurredAt.toISOString(),
    author: context.author,
    groupKey: groupKeyFor(event.sessionId),
    reactions: emptyReactionSummary(),
  };
  const linkContext = {
    isOwner: context.isOwner,
    username: context.author.username,
    sessionId: event.sessionId,
  };
  switch (type) {
    case 'SESSION_COMPLETED':
      return {
        ...base,
        type,
        link: activityLink(type, {
          ...linkContext,
          sessionExists: Boolean(context.session),
        }),
        session: {
          routineName: context.session?.routineName ?? 'Workout',
          dayName: context.session?.dayName ?? null,
          completedSets: num(payload.completedSets),
          volumeKg: num(payload.volumeKg),
          durationSec: context.session?.durationSec ?? null,
        },
      };
    case 'PERSONAL_RECORD': {
      const exerciseId = str(payload.exerciseId);
      return {
        ...base,
        type,
        link: activityLink(type, {
          ...linkContext,
          exerciseId,
          recordIsCurrent: context.recordIsCurrent,
        }),
        record: {
          exerciseId,
          exerciseName: str(payload.exerciseName, 'Exercise'),
          weightKg: num(payload.weight),
          reps: num(payload.reps),
          estimated1rmKg: num(payload.estimated1rm),
        },
      };
    }
    case 'PROGRESSION_CHANGED': {
      const exerciseId = str(payload.exerciseId);
      return {
        ...base,
        type,
        link: activityLink(type, { ...linkContext, exerciseId }),
        progression: {
          exerciseId,
          exerciseName: str(payload.exerciseName, 'Exercise'),
          sets: Array.isArray(payload.sets)
            ? (payload.sets as ProgressionSetChange[]).map((set) => ({
                setNumber: num(set.setNumber),
                targetReps: num(set.targetReps),
                performedReps: num(set.performedReps),
                previousWeightKg: num(set.previousWeightKg),
                newWeightKg: num(set.newWeightKg),
              }))
            : [],
        },
      };
    }
    case 'ACHIEVEMENT_UNLOCKED': {
      const definition = ACHIEVEMENT_DEFINITIONS.find(
        (candidate) => candidate.id === payload.id,
      );
      if (!definition) return null;
      return {
        ...base,
        type,
        link: activityLink(type, linkContext),
        achievement: {
          id: definition.id,
          title: definition.title,
          description: definition.description,
          category: definition.category,
        },
      };
    }
    case 'STREAK_MILESTONE': {
      const definition = ACHIEVEMENT_DEFINITIONS.find(
        (candidate) => candidate.id === payload.achievementId,
      );
      if (!definition) return null;
      return {
        ...base,
        type,
        link: activityLink(type, linkContext),
        streak: {
          achievementId: definition.id,
          title: definition.title,
          streakDays: num(payload.streakDays),
        },
      };
    }
  }
}

export function comebackToEntry(
  recognition: ComebackRecognition,
  context: EntryContext,
): ActivityEntry {
  return {
    id: recognition.id,
    type: 'COMEBACK',
    occurredAt: recognition.recognizedAt,
    author: context.author,
    groupKey: groupKeyFor(recognition.sourceSessionId),
    reactions: emptyReactionSummary(),
    link: activityLink('COMEBACK', {
      isOwner: context.isOwner,
      username: context.author.username,
    }),
    comeback: {
      inactiveDays: recognition.inactiveDays,
      activeDays: recognition.activeDays,
      windowDays: recognition.windowDays,
      returnedAt: recognition.returnedAt,
    },
  };
}

export const routineEntryKey = (routineId: string) => `routine:${routineId}`;

export function routineToEntry(
  routine: {
    id: string;
    name: string;
    sharedAt: Date;
    days: { _count: { exercises: number } }[];
  },
  context: EntryContext,
): ActivityEntry {
  return {
    id: routineEntryKey(routine.id),
    type: 'ROUTINE_SHARED',
    occurredAt: routine.sharedAt.toISOString(),
    author: context.author,
    groupKey: null,
    reactions: emptyReactionSummary(),
    link: activityLink('ROUTINE_SHARED', {
      isOwner: context.isOwner,
      username: context.author.username,
      routineId: routine.id,
    }),
    routine: {
      routineId: routine.id,
      name: routine.name,
      dayCount: routine.days.length,
      exerciseCount: routine.days.reduce(
        (total, day) => total + day._count.exercises,
        0,
      ),
    },
  };
}

// Pagination -----------------------------------------------------------------

/**
 * The cursor is the instant of the last entry returned plus the entries
 * already returned **at that instant**. The facts of one workout share its end
 * time, so ties are the normal case, not an edge; excluding what was seen
 * rather than comparing keys keeps the order independent of the database's
 * string collation, which need not agree with this process's. Seen entries
 * travel as short digests so the cursor stays small enough for a URL, which
 * is why sources fetch `limit + 1 + seen.length` and exclude here.
 */
export interface ActivityCursor {
  at: Date;
  seen: string[];
}

const CURSOR_SEEN_MAX = 500;

/** 66 bits of an entry's key; enough that two entries of one instant never collide. */
export const seenDigest = (entryId: string) =>
  createHash('sha256').update(entryId).digest('base64url').slice(0, 11);

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(
    JSON.stringify({ at: cursor.at.toISOString(), seen: cursor.seen }),
    'utf8',
  ).toString('base64url');
}

export function decodeActivityCursor(value?: string): ActivityCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as { at?: unknown; seen?: unknown };
    const at = typeof parsed.at === 'string' ? new Date(parsed.at) : null;
    if (
      !at ||
      Number.isNaN(at.getTime()) ||
      !Array.isArray(parsed.seen) ||
      parsed.seen.length > CURSOR_SEEN_MAX ||
      !parsed.seen.every(
        (digest) => typeof digest === 'string' && /^[\w-]{11}$/.test(digest),
      )
    ) {
      throw new Error('malformed');
    }
    return { at, seen: parsed.seen as string[] };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

/** Whether an entry comes after the cursor, i.e. was not returned yet. */
export const isAfterCursor = (
  entry: { id: string; occurredAt: string },
  cursor: ActivityCursor | null,
) => {
  if (!cursor) return true;
  const at = Date.parse(entry.occurredAt);
  if (at > cursor.at.getTime()) return false;
  if (at < cursor.at.getTime()) return true;
  return !cursor.seen.includes(seenDigest(entry.id));
};

const compareEntries = (
  a: { id: string; occurredAt: string },
  b: { id: string; occurredAt: string },
) =>
  Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * Merges candidates from every source, newest first, and cuts one page. Each
 * source must have supplied up to `limit + 1` candidates after the cursor, so
 * more than `limit` in total is exactly when another page exists.
 */
export const sourceTake = (limit: number, cursor: ActivityCursor | null) =>
  limit + 1 + (cursor?.seen.length ?? 0);

export function pageActivity<Entry extends { id: string; occurredAt: string }>(
  candidates: Entry[],
  limit: number,
  cursor: ActivityCursor | null,
): { entries: Entry[]; nextCursor?: string } {
  const sorted = candidates
    .filter((entry) => isAfterCursor(entry, cursor))
    .sort(compareEntries);
  const entries = sorted.slice(0, limit);
  if (sorted.length <= limit || entries.length === 0) return { entries };
  const last = entries[entries.length - 1];
  const at = new Date(last.occurredAt);
  const sameInstant = entries
    .filter((entry) => Date.parse(entry.occurredAt) === at.getTime())
    .map((entry) => seenDigest(entry.id));
  const carried =
    cursor && cursor.at.getTime() === at.getTime() ? cursor.seen : [];
  return {
    entries,
    nextCursor: encodeActivityCursor({
      at,
      seen: [...new Set([...carried, ...sameInstant])],
    }),
  };
}
