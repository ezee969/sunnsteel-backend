import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVITY_COMMENT_MAX_LENGTH,
  ACTIVITY_COMMENTS_PER_DAY_MAX,
  ACTIVITY_DEFAULT_AUDIENCE,
  ACTIVITY_FEED_FOLLOWED_MAX,
  type ActivityComment,
  type ActivityCommentsQuery,
  type ActivityCommentsResponse,
  type ActivityCommentSummary,
  type CreateActivityCommentRequest,
  type CreateActivityCommentResponse,
  type DeleteActivityCommentResponse,
  ACTIVITY_PAGE_DEFAULT_LIMIT,
  ACTIVITY_PAGE_MAX_LIMIT,
  ACTIVITY_TYPES,
  COMEBACK_SESSION_LOOKBACK,
  PROFILE_VISIBILITY_VALUES,
  ROUTINE_VISIBILITY_VALUES,
  type ActivityAudience,
  type ActivityEntry,
  type ActivityFeedResponse,
  type ActivityPage,
  type ActivityPageQuery,
  type ActivityPreviewQuery,
  type ActivityReaction,
  type ActivityReactionSummary,
  type ActivitySharingSettings,
  type ActivityType,
  type ComebackRecognition,
  type MemberActivityResponse,
  type OwnActivityEntry,
  type OwnActivityResponse,
  type ProfilePrivacySettings,
  type ProfileViewerAccess,
  type RoutineVisibility,
  type SetActivityEntryAudienceRequest,
  type SetActivityEntryAudienceResponse,
  type SetActivityReactionRequest,
  type SetActivityReactionResponse,
  type SharedRoutineOwner,
  type UpdateActivitySharingRequest,
} from '@sunsteel/contracts';
import { comebackRecognitionSummary } from '../achievements/comeback-recognition';
import { DatabaseService } from '../database/database.service';
import { canViewRoutine } from '../routines/routine-visibility';
import { readSnapshot } from '../workouts/analytics/session-snapshot';
import { routineDayName } from '../workouts/workout-session.selects';
import { hiddenFromViewer, isHiddenFromViewer } from '../users/member-blocks';
import { trainingPartnerPermissions } from '../users/training-partner-access';
import {
  mapProfilePrivacy,
  resolveProfileViewerAccess,
} from '../users/profile-privacy';
import { normalizeUsername } from '../users/username';
import {
  EVENT_ACTIVITY_TYPES,
  comebackToEntry,
  decodeActivityCursor,
  defaultAudienceFor,
  entrySharing,
  eventActivityType,
  emptyReactionSummary,
  eventToEntry,
  isAfterCursor,
  nextReaction,
  isPlanEmpty,
  pageActivity,
  planAllows,
  planAuthorActivity,
  routineEntryKey,
  routineToEntry,
  sourceTake,
  summarizeReactions,
  type ActivityCursor,
  type ActivityEventRow,
  type ActivitySessionFacts,
  type ActivityViewerContext,
  type AuthorActivityPlan,
  type AuthorSharingChoices,
  type EventActivityType,
  canDeleteComment,
  commentPageSize,
  decodeCommentCursor,
  emptyCommentSummary,
  encodeCommentCursor,
  normalizeCommentBody,
  summarizeComments,
} from './activity-rules';

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

type AuthorRow = Prisma.UserGetPayload<{ select: typeof AUTHOR_SELECT }>;

const EVENT_SELECT = {
  id: true,
  eventKey: true,
  userId: true,
  sessionId: true,
  type: true,
  occurredAt: true,
  payload: true,
} as const;

const ROUTINE_SELECT = {
  id: true,
  userId: true,
  name: true,
  sharedAt: true,
  visibility: true,
  moderationHiddenAt: true,
  days: {
    where: { trainingBlockId: null, temporaryOverrideId: null },
    select: { _count: { select: { exercises: true } } },
  },
} as const;

/**
 * Which training events can produce an entry at all, mirroring
 * `eventActivityType` so a page is cut from rows that will all render:
 * nothing recognized from history, and a streak achievement only as its
 * streak.
 */
const ELIGIBLE_EVENT_WHERE: Prisma.TrainingEventWhereInput = {
  OR: [
    { type: { in: ['SESSION_COMPLETED', 'PERSONAL_RECORD', 'PROGRESSION_CHANGED'] } },
    { type: 'STREAK_MILESTONE', payload: { path: ['backfilled'], equals: false } },
    {
      type: 'ACHIEVEMENT_UNLOCKED',
      payload: { path: ['backfilled'], equals: false },
      NOT: { payload: { path: ['category'], equals: 'STREAK_DAYS' } },
    },
  ],
};

interface Author {
  row: AuthorRow;
  identity: SharedRoutineOwner;
  privacy: ProfilePrivacySettings;
  context: ActivityViewerContext;
  access: ProfileViewerAccess;
  choices: AuthorSharingChoices;
  plan: AuthorActivityPlan;
}

interface ReadEntry {
  entry: ActivityEntry;
  type: ActivityType;
  userId: string;
  routineVisibility?: RoutineVisibility;
}

interface Candidate {
  id: string;
  occurredAt: string;
  build: () => ReadEntry | null;
}

const isEventType = (type: ActivityType): type is EventActivityType =>
  (EVENT_ACTIVITY_TYPES as readonly string[]).includes(type);

/**
 * SOC-03/SOC-04. Activity is **generated on read** from verified data --
 * training events, the `ACH-05` comeback derivation and shared routines --
 * and never stored; only the owner's choices are. Every read goes through one
 * path with a viewer context, so the feed, a member's activity and the
 * owner's preview of an audience cannot disagree about what that audience
 * sees.
 *
 * `PROF-10` is applied with this service's own `db` through the pure helpers,
 * never through an injected service, so no wiring mistake can make it fail
 * open.
 */
/** SOC-06: one comment row as every read of it needs. */
const COMMENT_SELECT = {
  id: true,
  entryKey: true,
  userId: true,
  authorId: true,
  body: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      username: true,
      name: true,
      lastName: true,
      avatarUrl: true,
    },
  },
} as const;

type CommentRow = {
  id: string;
  entryKey: string;
  userId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  user: {
    id: string;
    username: string | null;
    name: string;
    lastName: string | null;
    avatarUrl: string | null;
  };
};

/**
 * `canDelete` is resolved here rather than in the client, for the reason every
 * SOC-03 link is: the server decides what a viewer may do, and a control the
 * server would refuse must never be rendered.
 */
function toActivityComment(
  row: CommentRow,
  viewer: { viewerId: string; authorId: string },
): ActivityComment {
  return {
    id: row.id,
    entryId: row.entryKey,
    author: {
      id: row.user.id,
      username: row.user.username ?? '',
      name: row.user.name,
      lastName: row.user.lastName,
      avatarUrl: row.user.avatarUrl,
    },
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    canDelete: canDeleteComment(
      { userId: row.userId, authorId: row.authorId },
      viewer.viewerId,
    ),
  };
}

@Injectable()
export class ActivityService {
  constructor(private readonly db: DatabaseService) {}

  async feed(
    viewerId: string,
    query: ActivityPageQuery,
  ): Promise<ActivityFeedResponse> {
    const [hiddenIds, follows] = await Promise.all([
      hiddenFromViewer(this.db, viewerId),
      this.db.userFollow.findMany({
        where: { followerId: viewerId },
        orderBy: { createdAt: 'desc' },
        select: { followingId: true },
      }),
    ]);
    const hidden = new Set(hiddenIds);
    const followed = follows
      .map((row) => row.followingId)
      .filter((id) => !hidden.has(id));
    const considered = followed.slice(0, ACTIVITY_FEED_FOLLOWED_MAX);
    const rows = considered.length
      ? await this.db.user.findMany({
          where: { id: { in: considered } },
          select: AUTHOR_SELECT,
        })
      : [];
    const authors = await this.loadAuthors(
      rows.map((row) => ({ row, context: { isOwner: false, isFollower: true } })),
    );
    const page = await this.read(authors, query, viewerId);
    return {
      entries: page.entries.map((read) => read.entry),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      followedCount: followed.length,
      followedTruncated: followed.length > ACTIVITY_FEED_FOLLOWED_MAX,
    };
  }

  async member(
    viewerId: string,
    identifier: string,
    query: ActivityPageQuery,
  ): Promise<MemberActivityResponse> {
    const row = await this.db.user.findFirst({
      where: {
        OR: [{ id: identifier }, { username: normalizeUsername(identifier) }],
      },
      select: AUTHOR_SELECT,
    });
    if (!row) throw new NotFoundException('User not found');
    const isOwner = row.id === viewerId;
    // A block or a TRUST-04 hide answers 404 before any activity is read,
    // exactly as the profile does and for the same reason.
    if (!isOwner && (await isHiddenFromViewer(this.db, viewerId, row.id))) {
      throw new NotFoundException('User not found');
    }
    const [follow, partnerPermissions] = isOwner
      ? [null, null]
      : await Promise.all([
          this.db.userFollow.findUnique({
            where: {
              followerId_followingId: {
                followerId: viewerId,
                followingId: row.id,
              },
            },
            select: { followerId: true },
          }),
          trainingPartnerPermissions(this.db, viewerId, row.id),
        ]);
    const isFollower =
      !isOwner && (Boolean(follow) || partnerPermissions?.activity === true);
    const authors = await this.loadAuthors([
      { row, context: { isOwner, isFollower } },
    ]);
    const page = await this.read(authors, query, viewerId);
    return {
      entries: page.entries.map((read) => read.entry),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  /** Every entry of the owner's, with how each one is shared. */
  async mine(
    ownerId: string,
    query: ActivityPageQuery,
  ): Promise<OwnActivityResponse> {
    const row = await this.ownerRow(ownerId);
    const [author] = await this.loadAuthors([
      { row, context: { isOwner: true, isFollower: false } },
    ]);
    const page = await this.read([author], query, ownerId);
    return {
      entries: page.entries.map(
        (read): OwnActivityEntry => ({
          ...read.entry,
          sharing: entrySharing({
            type: read.type,
            privacy: author.privacy,
            defaultAudience: defaultAudienceFor(author.choices, read.type),
            override: author.choices.overrides.get(read.entry.id)?.audience ?? null,
            routineVisibility: read.routineVisibility,
          }),
        }),
      ),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  /**
   * The owner's activity as one audience receives it: the same read as the
   * feed and the profile, run as a hypothetical follower or non-follower, so
   * the preview is that audience's view rather than a second calculation.
   */
  async preview(
    ownerId: string,
    query: ActivityPreviewQuery,
  ): Promise<ActivityPage> {
    const row = await this.ownerRow(ownerId);
    const authors = await this.loadAuthors([
      {
        row,
        context: { isOwner: false, isFollower: query.audience === 'FOLLOWERS' },
      },
    ]);
    const page = await this.read(authors, query, ownerId);
    return {
      entries: page.entries.map((read) => read.entry),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  async sharing(ownerId: string): Promise<ActivitySharingSettings> {
    const [row, defaults] = await Promise.all([
      this.ownerRow(ownerId),
      this.db.activitySharingDefault.findMany({
        where: { userId: ownerId },
        select: { type: true, audience: true },
      }),
    ]);
    const stored = new Map(defaults.map((item) => [item.type, item.audience]));
    const privacy = mapProfilePrivacy(row);
    return {
      defaults: Object.fromEntries(
        ACTIVITY_TYPES.map((type) => [
          type,
          stored.get(type) ?? ACTIVITY_DEFAULT_AUDIENCE,
        ]),
      ) as ActivitySharingSettings['defaults'],
      sections: {
        workoutHistory: privacy.workoutHistory,
        records: privacy.records,
        achievements: privacy.achievements,
        routines: privacy.routines,
      },
    };
  }

  /** A partial write: a type left out keeps its stored default. */
  async updateSharing(
    ownerId: string,
    request: UpdateActivitySharingRequest,
  ): Promise<ActivitySharingSettings> {
    const entries = Object.entries(request.defaults ?? {});
    if (entries.length === 0) {
      throw new BadRequestException('Choose an audience for at least one type');
    }
    for (const [type, audience] of entries) {
      if (!(ACTIVITY_TYPES as readonly string[]).includes(type)) {
        throw new BadRequestException(`Unknown activity type: ${type}`);
      }
      if (!(PROFILE_VISIBILITY_VALUES as readonly unknown[]).includes(audience)) {
        throw new BadRequestException(`Invalid audience for ${type}`);
      }
    }
    await this.db.$transaction(
      entries.map(([type, audience]) =>
        this.db.activitySharingDefault.upsert({
          where: {
            userId_type: { userId: ownerId, type: type as ActivityType },
          },
          create: {
            userId: ownerId,
            type: type as ActivityType,
            audience: audience as ActivityAudience,
          },
          update: { audience: audience as ActivityAudience },
        }),
      ),
    );
    return this.sharing(ownerId);
  }

  /**
   * One entry's own audience. `PRIVATE` withdraws it; `null` returns it to
   * the type's default. Only an entry the owner actually has can be set, and
   * the section still caps whatever is chosen.
   */
  async setEntryAudience(
    ownerId: string,
    request: SetActivityEntryAudienceRequest,
  ): Promise<SetActivityEntryAudienceResponse> {
    const row = await this.ownerRow(ownerId);
    const entry = await this.resolveOwnEntry(ownerId, request.entryId);
    if (!entry) throw new NotFoundException('Activity entry not found');
    if (request.audience === null) {
      await this.db.activityEntryOverride.deleteMany({
        where: { userId: ownerId, entryKey: request.entryId },
      });
    } else {
      await this.db.activityEntryOverride.upsert({
        where: {
          userId_entryKey: { userId: ownerId, entryKey: request.entryId },
        },
        create: {
          userId: ownerId,
          entryKey: request.entryId,
          type: entry.type,
          audience: request.audience,
        },
        update: { type: entry.type, audience: request.audience },
      });
    }
    const stored = await this.db.activitySharingDefault.findUnique({
      where: { userId_type: { userId: ownerId, type: entry.type } },
      select: { audience: true },
    });
    return {
      entryId: request.entryId,
      sharing: entrySharing({
        type: entry.type,
        privacy: mapProfilePrivacy(row),
        defaultAudience: stored?.audience ?? ACTIVITY_DEFAULT_AUDIENCE,
        override: request.audience,
        routineVisibility: entry.routineVisibility,
      }),
    };
  }

  // Reading ------------------------------------------------------------------

  private async ownerRow(ownerId: string): Promise<AuthorRow> {
    const row = await this.db.user.findUnique({
      where: { id: ownerId },
      select: AUTHOR_SELECT,
    });
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  private async loadAuthors(
    inputs: { row: AuthorRow; context: ActivityViewerContext }[],
  ): Promise<Author[]> {
    if (inputs.length === 0) return [];
    const ids = inputs.map((input) => input.row.id);
    const [defaults, overrides] = await Promise.all([
      this.db.activitySharingDefault.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, type: true, audience: true },
      }),
      this.db.activityEntryOverride.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, entryKey: true, type: true, audience: true },
      }),
    ]);
    return inputs.map(({ row, context }) => {
      const choices: AuthorSharingChoices = {
        defaults: Object.fromEntries(
          defaults
            .filter((item) => item.userId === row.id)
            .map((item) => [item.type, item.audience]),
        ),
        overrides: new Map(
          overrides
            .filter((item) => item.userId === row.id)
            .map((item) => [
              item.entryKey,
              { type: item.type, audience: item.audience },
            ]),
        ),
      };
      const privacy = mapProfilePrivacy(row);
      const access = resolveProfileViewerAccess(privacy, context);
      return {
        row,
        identity: {
          username: row.username,
          name: row.name,
          lastName: row.lastName,
          avatarUrl: row.avatarUrl,
        },
        privacy,
        context,
        access,
        choices,
        plan: planAuthorActivity(access, choices, context),
      };
    });
  }

  private async read(
    allAuthors: Author[],
    query: ActivityPageQuery,
    viewerId: string,
  ): Promise<{ entries: ReadEntry[]; nextCursor?: string }> {
    const limit = Math.min(
      Math.max(query.limit ?? ACTIVITY_PAGE_DEFAULT_LIMIT, 1),
      ACTIVITY_PAGE_MAX_LIMIT,
    );
    const cursor = decodeActivityCursor(query.cursor);
    const authors = allAuthors.filter((author) => !isPlanEmpty(author.plan));
    if (authors.length === 0) return { entries: [] };
    const byId = new Map(authors.map((author) => [author.row.id, author]));

    const [events, routines, comebacks] = await Promise.all([
      this.readEvents(authors, limit, cursor),
      this.readRoutines(authors, limit, cursor),
      this.readComebacks(authors, cursor),
    ]);

    const candidates: Candidate[] = [];
    for (const event of events) {
      const author = byId.get(event.userId);
      const type = eventActivityType(event);
      // The query already applied the plan; this is the same rule asked
      // again, so a query that drifted could only ever show less.
      if (!author || !type || !planAllows(author.plan, type, event.eventKey)) {
        continue;
      }
      candidates.push({
        id: event.eventKey,
        occurredAt: event.occurredAt.toISOString(),
        build: () => null,
      });
    }
    const eventsByKey = new Map(events.map((event) => [event.eventKey, event]));

    for (const routine of routines) {
      const author = byId.get(routine.userId);
      if (!author || !routine.sharedAt) continue;
      const key = routineEntryKey(routine.id);
      if (
        !planAllows(author.plan, 'ROUTINE_SHARED', key) ||
        !canViewRoutine(
          author.privacy.routines,
          routine.visibility,
          author.context,
          routine,
        )
      ) {
        continue;
      }
      const sharedAt = routine.sharedAt;
      candidates.push({
        id: key,
        occurredAt: sharedAt.toISOString(),
        build: () => ({
          entry: routineToEntry(
            { ...routine, sharedAt },
            { author: author.identity, isOwner: author.context.isOwner },
          ),
          type: 'ROUTINE_SHARED',
          userId: author.row.id,
          routineVisibility: routine.visibility,
        }),
      });
    }

    for (const { author, recognition } of comebacks) {
      candidates.push({
        id: recognition.id,
        occurredAt: recognition.recognizedAt,
        build: () => ({
          entry: comebackToEntry(recognition, {
            author: author.identity,
            isOwner: author.context.isOwner,
          }),
          type: 'COMEBACK',
          userId: author.row.id,
        }),
      });
    }

    const page = pageActivity(candidates, limit, cursor);
    const pageEvents = page.entries.flatMap((candidate) => {
      const event = eventsByKey.get(candidate.id);
      return event ? [event] : [];
    });
    const [sessions, currentRecords] = await Promise.all([
      this.sessionFacts(pageEvents, byId),
      this.currentRecords(pageEvents, byId),
    ]);

    const entries = page.entries.flatMap((candidate): ReadEntry[] => {
      const event = eventsByKey.get(candidate.id);
      if (!event) {
        const built = candidate.build();
        return built ? [built] : [];
      }
      const author = byId.get(event.userId)!;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const entry = eventToEntry(event, {
        author: author.identity,
        isOwner: author.context.isOwner,
        session: event.sessionId ? sessions.get(event.sessionId) : undefined,
        recordIsCurrent: currentRecords.has(
          `${event.userId}:${String(payload.exerciseId)}:${String(payload.setLogId)}`,
        ),
      });
      return entry
        ? [{ entry, type: entry.type, userId: event.userId }]
        : [];
    });
    const entryIds = entries.map((read) => read.entry.id);
    const [reactions, comments] = await Promise.all([
      this.readReactions(entryIds, viewerId),
      this.readCommentSummaries(entryIds, viewerId),
    ]);
    for (const read of entries) {
      read.entry.reactions =
        reactions.get(read.entry.id) ?? emptyReactionSummary();
      read.entry.comments =
        comments.get(read.entry.id) ?? emptyCommentSummary();
    }
    return {
      entries,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  /**
   * SOC-05. One query for the page. Members either side of a block are left
   * out of the counts, so a number can never reveal one of them; there is no
   * list of who reacted, only totals and the viewer's own choice.
   */
  private async readReactions(
    entryKeys: string[],
    viewerId: string,
  ): Promise<Map<string, ActivityReactionSummary>> {
    if (entryKeys.length === 0) return new Map();
    const [rows, hiddenIds] = await Promise.all([
      this.db.activityEntryReaction.findMany({
        where: { entryKey: { in: entryKeys } },
        select: { entryKey: true, userId: true, reaction: true },
      }),
      hiddenFromViewer(this.db, viewerId),
    ]);
    const hidden = new Set(hiddenIds);
    const byEntry = new Map<
      string,
      { userId: string; reaction: ActivityReaction }[]
    >();
    for (const row of rows) {
      if (hidden.has(row.userId)) continue;
      const list = byEntry.get(row.entryKey) ?? [];
      list.push({ userId: row.userId, reaction: row.reaction });
      byEntry.set(row.entryKey, list);
    }
    return new Map(
      [...byEntry].map(([key, list]) => [key, summarizeReactions(list, viewerId)]),
    );
  }

  /**
   * SOC-06. One query for the page, mirroring `readReactions`. Both sides of a
   * block and every moderator-hidden comment are excluded, so the count always
   * matches what a read of the list returns for this viewer -- a count that
   * disagreed would advertise a comment they cannot open.
   *
   * The viewer's own budget is read once for the whole page rather than per
   * entry: it is the same number on every row.
   */
  private async readCommentSummaries(
    entryKeys: string[],
    viewerId: string,
  ): Promise<Map<string, ActivityCommentSummary>> {
    if (entryKeys.length === 0) return new Map();
    const [rows, hiddenIds, commentsToday] = await Promise.all([
      this.db.activityComment.findMany({
        where: { entryKey: { in: entryKeys }, moderationHiddenAt: null },
        select: { entryKey: true, userId: true },
      }),
      hiddenFromViewer(this.db, viewerId),
      this.commentsToday(viewerId),
    ]);
    const hidden = new Set(hiddenIds);
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (hidden.has(row.userId)) continue;
      counts.set(row.entryKey, (counts.get(row.entryKey) ?? 0) + 1);
    }
    return new Map(
      entryKeys.map((key) => [
        key,
        summarizeComments(counts.get(key) ?? 0, { commentsToday }),
      ]),
    );
  }

  /** How many comments this account has written in the last 24 hours. */
  private async commentsToday(viewerId: string): Promise<number> {
    return this.db.activityComment.count({
      where: {
        userId: viewerId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
  }

  /**
   * SOC-06. The entry gate, reused rather than restated: the same resolution a
   * reaction goes through decides whether this viewer may read or write a
   * comment. A viewer who may not see the entry gets **404**, never 403, which
   * would confirm it exists.
   *
   * Returns the entry's author id, because every caller needs it: the list
   * read to resolve `canDelete`, the write to store it beside the comment.
   *
   * Unlike a reaction, the owner is allowed through: replying on your own
   * activity is ordinary, where acknowledging your own work is not.
   */
  private async resolveCommentableEntry(
    viewerId: string,
    entryId: string,
  ): Promise<string> {
    const authorId = await this.resolveEntryAuthor(entryId);
    if (!authorId) throw new NotFoundException('Activity entry not found');
    const isOwner = authorId === viewerId;
    const [row, hidden] = await Promise.all([
      this.db.user.findUnique({
        where: { id: authorId },
        select: AUTHOR_SELECT,
      }),
      isOwner
        ? Promise.resolve(false)
        : isHiddenFromViewer(this.db, viewerId, authorId),
    ]);
    if (!row || hidden) throw new NotFoundException('Activity entry not found');
    const [follow, partnerPermissions] = isOwner
      ? [null, null]
      : await Promise.all([
          this.db.userFollow.findUnique({
            where: {
              followerId_followingId: {
                followerId: viewerId,
                followingId: authorId,
              },
            },
            select: { followerId: true },
          }),
          trainingPartnerPermissions(this.db, viewerId, authorId),
        ]);
    const isFollower =
      !isOwner && (Boolean(follow) || partnerPermissions?.activity === true);
    const [author] = await this.loadAuthors([
      { row, context: { isOwner, isFollower } },
    ]);
    const visible = await this.isEntryVisible(author, entryId);
    if (!visible) throw new NotFoundException('Activity entry not found');
    return authorId;
  }

  /** One entry's comments, oldest first. Paged by `(createdAt, id)`. */
  async listComments(
    viewerId: string,
    query: ActivityCommentsQuery,
  ): Promise<ActivityCommentsResponse> {
    const authorId = await this.resolveCommentableEntry(viewerId, query.entryId);
    const take = commentPageSize(query.limit);
    const cursor = decodeCommentCursor(query.cursor);
    const hiddenIds = await hiddenFromViewer(this.db, viewerId);

    const rows = await this.db.activityComment.findMany({
      where: {
        entryKey: query.entryId,
        ...(hiddenIds.length ? { userId: { notIn: hiddenIds } } : {}),
        AND: [
          // A moderator-hidden comment is gone for everyone but the member who
          // wrote it, the same narrowing TRUST-04 applies to a routine.
          { OR: [{ moderationHiddenAt: null }, { userId: viewerId }] },
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { gt: cursor.at } },
                    { createdAt: cursor.at, id: { gt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
      select: COMMENT_SELECT,
    });

    const page = rows.slice(0, take);
    const last = page.at(-1);
    const summaries = await this.readCommentSummaries([query.entryId], viewerId);
    return {
      entryId: query.entryId,
      comments: page.map((row) => toActivityComment(row, { viewerId, authorId })),
      nextCursor:
        rows.length > take && last
          ? encodeCommentCursor({ at: last.createdAt, id: last.id })
          : null,
      summary: summaries.get(query.entryId) ?? emptyCommentSummary(),
    };
  }

  /**
   * SOC-06. Anyone who may read the entry may comment on it: there is no
   * second permission, because a separate rule is a second answer to "may this
   * viewer see this entry", and the one that drifts is the one nobody looks at.
   */
  async createComment(
    viewerId: string,
    request: CreateActivityCommentRequest,
  ): Promise<CreateActivityCommentResponse> {
    const authorId = await this.resolveCommentableEntry(
      viewerId,
      request.entryId,
    );
    const body = normalizeCommentBody(request.body);
    if (!body) {
      throw new BadRequestException(
        `A comment must not be empty and may be at most ${ACTIVITY_COMMENT_MAX_LENGTH} characters.`,
      );
    }
    if ((await this.commentsToday(viewerId)) >= ACTIVITY_COMMENTS_PER_DAY_MAX) {
      throw new HttpException(
        `You can write at most ${ACTIVITY_COMMENTS_PER_DAY_MAX} comments a day.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const created = await this.db.activityComment.create({
      data: { entryKey: request.entryId, userId: viewerId, authorId, body },
      select: COMMENT_SELECT,
    });
    const summaries = await this.readCommentSummaries(
      [request.entryId],
      viewerId,
    );
    return {
      comment: toActivityComment(created, { viewerId, authorId }),
      summary: summaries.get(request.entryId) ?? emptyCommentSummary(),
    };
  }

  /**
   * Two people may delete a comment: its author, and the owner of the activity
   * it hangs from. A moderator is not one of them -- `TRUST-04` hides rather
   * than deletes, so the enforcement record stays the only account of what a
   * moderator did and nothing they touch is destroyed.
   *
   * A comment this viewer may not delete answers 404 rather than 403, so the
   * refusal cannot be used to learn that it exists.
   */
  async deleteComment(
    viewerId: string,
    commentId: string,
  ): Promise<DeleteActivityCommentResponse> {
    const comment = await this.db.activityComment.findUnique({
      where: { id: commentId },
      select: { id: true, entryKey: true, userId: true, authorId: true },
    });
    if (!comment || !canDeleteComment(comment, viewerId)) {
      throw new NotFoundException('Comment not found');
    }
    await this.db.activityComment.delete({ where: { id: comment.id } });
    const summaries = await this.readCommentSummaries(
      [comment.entryKey],
      viewerId,
    );
    return {
      entryId: comment.entryKey,
      summary: summaries.get(comment.entryKey) ?? emptyCommentSummary(),
    };
  }

  private async readEvents(
    authors: Author[],
    limit: number,
    cursor: ActivityCursor | null,
  ): Promise<ActivityEventRow[]> {
    const perAuthor: Prisma.TrainingEventWhereInput[] = [];
    for (const author of authors) {
      const byDefault = [...author.plan.visibleTypes].filter(isEventType);
      const included = [...author.plan.include]
        .filter(([, type]) => isEventType(type))
        .map(([key]) => key);
      const parts: Prisma.TrainingEventWhereInput[] = [];
      if (byDefault.length) {
        parts.push({
          type: { in: byDefault },
          ...(author.plan.exclude.size
            ? { eventKey: { notIn: [...author.plan.exclude] } }
            : {}),
        });
      }
      if (included.length) parts.push({ eventKey: { in: included } });
      if (parts.length) perAuthor.push({ userId: author.row.id, OR: parts });
    }
    if (perAuthor.length === 0) return [];
    return this.db.trainingEvent.findMany({
      where: {
        AND: [
          { OR: perAuthor },
          ELIGIBLE_EVENT_WHERE,
          ...(cursor ? [{ occurredAt: { lte: cursor.at } }] : []),
        ],
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: sourceTake(limit, cursor),
      select: EVENT_SELECT,
    });
  }

  private async readRoutines(
    authors: Author[],
    limit: number,
    cursor: ActivityCursor | null,
  ) {
    const perAuthor: Prisma.RoutineWhereInput[] = [];
    for (const author of authors) {
      // The routine's own rule, asked through the shipped function for each
      // value it can hold, so the query is `canViewRoutine` and not a copy.
      const readable = ROUTINE_VISIBILITY_VALUES.filter((visibility) =>
        canViewRoutine(author.privacy.routines, visibility, author.context, {
          moderationHiddenAt: null,
        }),
      );
      if (readable.length === 0) continue;
      const excluded = [...author.plan.exclude]
        .filter((key) => key.startsWith('routine:'))
        .map((key) => key.slice('routine:'.length));
      const included = [...author.plan.include]
        .filter(([, type]) => type === 'ROUTINE_SHARED')
        .map(([key]) => key.slice('routine:'.length));
      const parts: Prisma.RoutineWhereInput[] = [];
      if (author.plan.visibleTypes.has('ROUTINE_SHARED')) {
        parts.push(excluded.length ? { id: { notIn: excluded } } : {});
      }
      if (included.length) parts.push({ id: { in: included } });
      if (parts.length) {
        perAuthor.push({
          userId: author.row.id,
          visibility: { in: readable },
          // TRUST-04: a hidden routine leaves every feed but its owner's, the
          // same narrowing `canViewRoutine` applies row by row below.
          ...(author.context.isOwner ? {} : { moderationHiddenAt: null }),
          OR: parts,
        });
      }
    }
    if (perAuthor.length === 0) return [];
    return this.db.routine.findMany({
      where: {
        OR: perAuthor,
        sharedAt: { not: null, ...(cursor ? { lte: cursor.at } : {}) },
        // A routine with nothing programmed is not a programme anyone can
        // follow, so sharing one is not news, as `ROUT-07` decided.
        days: { some: { trainingBlockId: null, temporaryOverrideId: null, exercises: { some: {} } } },
      },
      orderBy: [{ sharedAt: 'desc' }, { id: 'desc' }],
      take: sourceTake(limit, cursor),
      select: ROUTINE_SELECT,
    });
  }

  /**
   * Comebacks are derived, not stored, through the shipped `ACH-05` function
   * and its own bound, so the feed and the achievements ledger always agree
   * on which returns count.
   */
  private async readComebacks(
    authors: Author[],
    cursor: ActivityCursor | null,
  ): Promise<{ author: Author; recognition: ComebackRecognition }[]> {
    const eligible = authors.filter(
      (author) =>
        author.plan.visibleTypes.has('COMEBACK') ||
        [...author.plan.include.values()].includes('COMEBACK'),
    );
    const results = await Promise.all(
      eligible.map(async (author) => {
        const recognitions = await this.comebackRecognitions(author.row.id);
        return recognitions
          .filter((recognition) =>
            planAllows(author.plan, 'COMEBACK', recognition.id),
          )
          .filter((recognition) =>
            isAfterCursor(
              { id: recognition.id, occurredAt: recognition.recognizedAt },
              cursor,
            ),
          )
          .map((recognition) => ({ author, recognition }));
      }),
    );
    return results.flat();
  }

  private async comebackRecognitions(
    userId: string,
  ): Promise<ComebackRecognition[]> {
    const projection = await this.db.workoutAnalyticsProjection.findFirst({
      where: { userId, active: true, state: 'READY' },
      select: { timeZone: true },
    });
    if (!projection) return [];
    const events = await this.db.trainingEvent.findMany({
      where: { userId, type: 'SESSION_COMPLETED' },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: COMEBACK_SESSION_LOOKBACK + 1,
      select: { id: true, sessionId: true, occurredAt: true },
    });
    return comebackRecognitionSummary(
      events.slice(0, COMEBACK_SESSION_LOOKBACK),
      projection.timeZone,
      events.length > COMEBACK_SESSION_LOOKBACK,
    ).recognitions;
  }

  private async sessionFacts(
    events: ActivityEventRow[],
    authors: Map<string, Author>,
  ): Promise<Map<string, ActivitySessionFacts>> {
    const ids = [
      ...new Set(
        events.flatMap((event) =>
          event.type === 'SESSION_COMPLETED' && event.sessionId
            ? [event.sessionId]
            : [],
        ),
      ),
    ];
    if (ids.length === 0) return new Map();
    const sessions = await this.db.workoutSession.findMany({
      where: { id: { in: ids }, userId: { in: [...authors.keys()] } },
      select: {
        id: true,
        durationSec: true,
        snapshot: { select: { payload: true } },
        routine: { select: { name: true } },
        routineDay: { select: { dayOfWeek: true, name: true, order: true } },
      },
    });
    return new Map(
      sessions.map((session) => {
        let snapshot: ReturnType<typeof readSnapshot> | null = null;
        try {
          snapshot = session.snapshot
            ? readSnapshot(session.snapshot.payload)
            : null;
        } catch {
          snapshot = null;
        }
        return [
          session.id,
          {
            routineName:
              snapshot?.routine.name ?? session.routine?.name ?? 'Workout',
            dayName: routineDayName(snapshot?.routineDay ?? session.routineDay),
            durationSec: session.durationSec,
          },
        ];
      }),
    );
  }

  /**
   * For records seen by somebody else: which ones are still the best the
   * profile shows, because only those have a place the viewer may open.
   */
  private async currentRecords(
    events: ActivityEventRow[],
    authors: Map<string, Author>,
  ): Promise<Set<string>> {
    const pairs = events.flatMap((event) => {
      if (event.type !== 'PERSONAL_RECORD') return [];
      if (authors.get(event.userId)?.context.isOwner) return [];
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      return typeof payload.exerciseId === 'string'
        ? [{ userId: event.userId, exerciseId: payload.exerciseId }]
        : [];
    });
    if (pairs.length === 0) return new Set();
    const records = await this.db.personalRecord.findMany({
      where: { OR: pairs },
      select: { userId: true, exerciseId: true, setLogId: true },
    });
    return new Set(
      records.map(
        (record) => `${record.userId}:${record.exerciseId}:${record.setLogId}`,
      ),
    );
  }

  /**
   * SOC-05. A reaction on one entry, gated by the read that already decides
   * who may see that entry: the author is resolved from the key, the same
   * plan is rebuilt for this viewer, and an entry they may not see answers
   * **404**, exactly as the member read does — never a 403, which would
   * confirm the entry exists. Reacting to your own activity is refused
   * outright; there is nothing to acknowledge.
   */
  async setReaction(
    viewerId: string,
    request: SetActivityReactionRequest,
  ): Promise<SetActivityReactionResponse> {
    const authorId = await this.resolveEntryAuthor(request.entryId);
    if (!authorId) throw new NotFoundException('Activity entry not found');
    if (authorId === viewerId) {
      throw new BadRequestException('You cannot react to your own activity');
    }
    const [row, hidden] = await Promise.all([
      this.db.user.findUnique({ where: { id: authorId }, select: AUTHOR_SELECT }),
      isHiddenFromViewer(this.db, viewerId, authorId),
    ]);
    if (!row || hidden) {
      throw new NotFoundException('Activity entry not found');
    }
    const [follow, partnerPermissions] = await Promise.all([
      this.db.userFollow.findUnique({
        where: {
          followerId_followingId: { followerId: viewerId, followingId: authorId },
        },
        select: { followerId: true },
      }),
      trainingPartnerPermissions(this.db, viewerId, authorId),
    ]);
    const isFollower =
      Boolean(follow) || partnerPermissions.activity === true;
    const [author] = await this.loadAuthors([
      { row, context: { isOwner: false, isFollower } },
    ]);
    const visible = await this.isEntryVisible(author, request.entryId);
    if (!visible) throw new NotFoundException('Activity entry not found');

    const current = await this.db.activityEntryReaction.findUnique({
      where: {
        userId_entryKey: { userId: viewerId, entryKey: request.entryId },
      },
      select: { reaction: true },
    });
    const next = nextReaction(current?.reaction ?? null, request.reaction);
    if (next === null) {
      await this.db.activityEntryReaction.deleteMany({
        where: { userId: viewerId, entryKey: request.entryId },
      });
    } else {
      await this.db.activityEntryReaction.upsert({
        where: {
          userId_entryKey: { userId: viewerId, entryKey: request.entryId },
        },
        create: {
          userId: viewerId,
          entryKey: request.entryId,
          authorId,
          reaction: next,
        },
        update: { reaction: next, authorId },
      });
    }
    const summaries = await this.readReactions([request.entryId], viewerId);
    return {
      entryId: request.entryId,
      reactions: summaries.get(request.entryId) ?? emptyReactionSummary(),
    };
  }

  /** Who an entry belongs to, or null when no such entry exists. */
  private async resolveEntryAuthor(entryId: string): Promise<string | null> {
    if (entryId.startsWith('routine:')) {
      const routine = await this.db.routine.findFirst({
        where: {
          id: entryId.slice('routine:'.length),
          sharedAt: { not: null },
          days: { some: { trainingBlockId: null, temporaryOverrideId: null, exercises: { some: {} } } },
        },
        select: { userId: true },
      });
      return routine?.userId ?? null;
    }
    if (entryId.startsWith('comeback:')) {
      // `comeback:<returnEventId>:<recognitionEventId>:v1`; both belong to the
      // member whose return it was, and the derivation below confirms it.
      const recognitionEventId = entryId.split(':')[2];
      const event = recognitionEventId
        ? await this.db.trainingEvent.findUnique({
            where: { id: recognitionEventId },
            select: { userId: true, type: true },
          })
        : null;
      if (!event || event.type !== 'SESSION_COMPLETED') return null;
      const recognitions = await this.comebackRecognitions(event.userId);
      return recognitions.some((recognition) => recognition.id === entryId)
        ? event.userId
        : null;
    }
    const event = await this.db.trainingEvent.findUnique({
      where: { eventKey: entryId },
      select: { userId: true, type: true, payload: true },
    });
    if (!event || !eventActivityType(event)) return null;
    return event.userId;
  }

  /** Whether this author's entry is one the viewer's plan allows right now. */
  private async isEntryVisible(
    author: Author,
    entryId: string,
  ): Promise<boolean> {
    if (isPlanEmpty(author.plan)) return false;
    if (entryId.startsWith('routine:')) {
      const routine = await this.db.routine.findUnique({
        where: { id: entryId.slice('routine:'.length) },
        select: { visibility: true, moderationHiddenAt: true },
      });
      return (
        !!routine &&
        planAllows(author.plan, 'ROUTINE_SHARED', entryId) &&
        canViewRoutine(
          author.privacy.routines,
          routine.visibility,
          author.context,
          routine,
        )
      );
    }
    if (entryId.startsWith('comeback:')) {
      return planAllows(author.plan, 'COMEBACK', entryId);
    }
    const event = await this.db.trainingEvent.findUnique({
      where: { eventKey: entryId },
      select: { type: true, payload: true },
    });
    const type = event ? eventActivityType(event) : null;
    return !!type && planAllows(author.plan, type, entryId);
  }

  /** The type of one of the owner's own entries, or null when they have no such entry. */
  private async resolveOwnEntry(
    ownerId: string,
    entryId: string,
  ): Promise<{ type: ActivityType; routineVisibility?: RoutineVisibility } | null> {
    if (entryId.startsWith('routine:')) {
      const routine = await this.db.routine.findFirst({
        where: {
          id: entryId.slice('routine:'.length),
          userId: ownerId,
          sharedAt: { not: null },
        },
        select: { visibility: true },
      });
      return routine
        ? { type: 'ROUTINE_SHARED', routineVisibility: routine.visibility }
        : null;
    }
    if (entryId.startsWith('comeback:')) {
      const recognitions = await this.comebackRecognitions(ownerId);
      return recognitions.some((recognition) => recognition.id === entryId)
        ? { type: 'COMEBACK' }
        : null;
    }
    const event = await this.db.trainingEvent.findUnique({
      where: { eventKey: entryId },
      select: { userId: true, type: true, payload: true },
    });
    if (!event || event.userId !== ownerId) return null;
    const type = eventActivityType(event);
    return type ? { type } : null;
  }
}
