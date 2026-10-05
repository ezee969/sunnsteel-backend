import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  MODERATION_HISTORY_PAGE_SIZE,
  type ModerationActionKind,
  type ModerationActionRecord,
  type ModerationHistoryQuery,
  type ModerationHistoryResponse,
  type ModerationQueueQuery,
  type ModerationQueueResponse,
  type ModerationReport,
  type ReportStatus,
  type ReportSubjectKind,
  type ReportSubjectPreview,
  type ReportedMessageContext,
  type ReviewReportResponse,
  type UserSearchResponse,
  apiError,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { readCapturedMessages } from "../messages/message-moderation";
import { canViewRoutine } from "../routines/routine-visibility";
import { isHiddenFromViewer } from "../users/member-blocks";
import {
  clampPageSize,
  decodeQueueCursor,
  encodeQueueCursor,
  queuePageSize,
  resolvesReport,
  statusAfter,
  type ResolvedSubject,
} from "./moderation-rules";

const MEMBER_SELECT = {
  id: true,
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
} as const;

interface MemberRow {
  id: string;
  username: string | null;
  name: string;
  lastName: string | null;
  avatarUrl: string | null;
}

function toMember(row: MemberRow): UserSearchResponse {
  return {
    id: row.id,
    username: row.username ?? "",
    name: row.name,
    lastName: row.lastName,
    avatarUrl: row.avatarUrl,
  };
}

type ResolvedSubjectDetail = ResolvedSubject & {
  owner: MemberRow | null;
  readable: boolean;
  /** MSG-09: the member's (or message author's) restriction; null otherwise. */
  messagingRestricted: boolean | null;
  /** MSG-09: a reported message deleted or removed since its capture. */
  messageGone: boolean;
};

/** MSG-09: the powers over an account's messaging, rather than one subject. */
function isMessagingAction(kind: ModerationActionKind): boolean {
  return (
    kind === "RESTRICT_MESSAGING" || kind === "LIFT_MESSAGING_RESTRICTION"
  );
}

/**
 * TRUST-04. The review side of `PROF-10`: a queue over the reports that were
 * already being recorded, two enforcement actions, and an append-only log of
 * every power a moderator used -- reading a subject included.
 *
 * Two properties are the point of the whole module and are the easy ones to
 * lose in a later change.
 *
 * **A moderator reads no more than anyone else.** Resolving a reported
 * subject runs the shipped `PROF-06`/`PROF-10` rules with the moderator as
 * the viewer, so the queue can say a subject is withheld but cannot reveal
 * it. A bypass would turn one boolean into a key to every private profile in
 * the product, and the worth of that key does not depend on who holds it
 * today. A moderator who genuinely must read something private has to be
 * granted it the way any other member would.
 *
 * **Every record is written once.** There is no update and no delete path for
 * a `ModerationAction` anywhere in this file. Undoing a hide appends a
 * `RESTORE_SUBJECT` row; the `HIDE_SUBJECT` row it supersedes stays exactly
 * as it was written, which is what makes the log evidence rather than a
 * cache of the current state.
 *
 * MSG-09 adds messages, which have no page of their own and are shared with
 * nobody but the other participant. A message report therefore carries the
 * reporter's own view -- the message and up to five before it, captured when
 * it was filed -- and that capture is the one thing a moderator reads, only
 * through the logged view, whatever blocks stand (the owner's decision at
 * claim: it is the reporter's evidence, handed over, and withholding it under
 * a block would let anyone evade review by blocking the moderator). Nothing
 * else of a conversation is readable. A message can be hidden from the other
 * participant, and an account's messaging restricted and lifted.
 */
@Injectable()
export class ModerationService {
  constructor(private readonly db: DatabaseService) {}

  async queue(
    moderatorId: string,
    query: ModerationQueueQuery,
  ): Promise<ModerationQueueResponse> {
    const status: ReportStatus = query.status ?? "OPEN";
    const take = queuePageSize(query.limit);
    const cursor = decodeQueueCursor(query.cursor);

    const where: Prisma.MemberReportWhereInput = {
      status,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.at } },
              { createdAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const [rows, openCount] = await Promise.all([
      this.db.memberReport.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        select: REPORT_SELECT,
      }),
      this.db.memberReport.count({ where: { status: "OPEN" } }),
    ]);

    const page = rows.slice(0, take);
    const reports = await Promise.all(
      page.map((row) => this.toReport(moderatorId, row)),
    );
    const last = page.at(-1);
    return {
      reports,
      nextCursor:
        rows.length > take && last
          ? encodeQueueCursor({ at: last.createdAt, id: last.id })
          : null,
      openCount,
    };
  }

  async history(
    query: ModerationHistoryQuery,
  ): Promise<ModerationHistoryResponse> {
    const take = clampPageSize(query.limit, MODERATION_HISTORY_PAGE_SIZE);
    const cursor = decodeQueueCursor(query.cursor);
    const rows = await this.db.moderationAction.findMany({
      where: {
        ...(query.subjectKind && query.subjectId
          ? { subjectKind: query.subjectKind, subjectId: query.subjectId }
          : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      select: ACTION_SELECT,
    });
    const page = rows.slice(0, take);
    const last = page.at(-1);
    return {
      actions: page.map((row) => this.toActionRecord(row)),
      nextCursor:
        rows.length > take && last
          ? encodeQueueCursor({ at: last.createdAt, id: last.id })
          : null,
    };
  }

  /**
   * Opening a reported subject. The record is written **before** the answer,
   * so a read that happened cannot be one that went unlogged; the moderator
   * then opens the subject on its own page, where the ordinary rules decide
   * what they see. There is deliberately no mirror of the content here -- a
   * second read path is a second answer to "may this viewer see this", and
   * the one that drifts is always the one nobody is looking at.
   */
  async recordView(
    moderatorId: string,
    reportId: string,
  ): Promise<ReviewReportResponse> {
    const response = await this.act(moderatorId, reportId, "VIEW_SUBJECT", null);
    // MSG-09: the capture is answered only here, after its record is written,
    // so the read and the record are one request.
    if (response.report.subject.kind !== "MESSAGE") return response;
    const messageContext = await this.messageContext(reportId);
    return messageContext ? { ...response, messageContext } : response;
  }

  async dismiss(
    moderatorId: string,
    reportId: string,
    note: string | null,
  ): Promise<ReviewReportResponse> {
    return this.act(moderatorId, reportId, "DISMISS_REPORT", note);
  }

  async hide(
    moderatorId: string,
    reportId: string,
    note: string | null,
  ): Promise<ReviewReportResponse> {
    return this.act(moderatorId, reportId, "HIDE_SUBJECT", note);
  }

  async restore(
    moderatorId: string,
    reportId: string,
    note: string | null,
  ): Promise<ReviewReportResponse> {
    return this.act(moderatorId, reportId, "RESTORE_SUBJECT", note);
  }

  /** MSG-09: the account stops sending and starting conversations. */
  async restrictMessaging(
    moderatorId: string,
    reportId: string,
    note: string | null,
  ): Promise<ReviewReportResponse> {
    return this.act(moderatorId, reportId, "RESTRICT_MESSAGING", note);
  }

  async liftMessagingRestriction(
    moderatorId: string,
    reportId: string,
    note: string | null,
  ): Promise<ReviewReportResponse> {
    return this.act(moderatorId, reportId, "LIFT_MESSAGING_RESTRICTION", note);
  }

  /**
   * One transaction per action: the record, the report's status and -- for a
   * hide or a restore -- the subject's own column, so the log can never say
   * something the data disagrees with.
   */
  private async act(
    moderatorId: string,
    reportId: string,
    kind: ModerationActionKind,
    note: string | null,
  ): Promise<ReviewReportResponse> {
    const report = await this.db.memberReport.findUnique({
      where: { id: reportId },
      select: { id: true, status: true, subjectKind: true, subjectId: true },
    });
    if (!report) throw new NotFoundException(apiError("REPORT_NOT_FOUND"));

    const subject = await this.resolveSubject(
      moderatorId,
      report.subjectKind,
      report.subjectId,
      report.id,
    );
    const isMissing = subject.resolvedId === null;

    if (kind === "HIDE_SUBJECT" || kind === "RESTORE_SUBJECT") {
      if (isMissing || subject.messageGone) {
        throw new ConflictException(apiError("REPORTED_CONTENT_GONE"));
      }
      if (kind === "HIDE_SUBJECT" && subject.isHidden) {
        throw new ConflictException(
          apiError("REPORTED_CONTENT_ALREADY_HIDDEN"),
        );
      }
      if (kind === "RESTORE_SUBJECT" && !subject.isHidden) {
        throw new ConflictException(apiError("REPORTED_CONTENT_NOT_HIDDEN"));
      }
    }
    if (isMessagingAction(kind)) {
      if (report.subjectKind !== "MEMBER" && report.subjectKind !== "MESSAGE") {
        throw new BadRequestException(
          "Messaging is restricted only from a member or a message report",
        );
      }
      if (subject.ownerId === null || subject.messagingRestricted === null) {
        throw new ConflictException(apiError("REPORTED_CONTENT_GONE"));
      }
      if (kind === "RESTRICT_MESSAGING" && subject.messagingRestricted) {
        throw new ConflictException(apiError("MESSAGING_ALREADY_RESTRICTED"));
      }
      if (
        kind === "LIFT_MESSAGING_RESTRICTION" &&
        !subject.messagingRestricted
      ) {
        throw new ConflictException(apiError("MESSAGING_NOT_RESTRICTED"));
      }
    }
    if (kind === "VIEW_SUBJECT" && isMissing) {
      throw new NotFoundException(apiError("REPORTED_CONTENT_GONE"));
    }
    if (resolvesReport(kind) && report.status !== "OPEN") {
      throw new ConflictException(apiError("REPORT_ALREADY_REVIEWED"));
    }

    // Whatever the reporter typed, the record stores what it resolved to: a
    // username is not a stable identity, and an enforcement record has to
    // name the thing it was about years later. A restriction is about the
    // account, so it is recorded against the member, from this report.
    const messaging = isMessagingAction(kind);
    const subjectKind: ReportSubjectKind = messaging
      ? "MEMBER"
      : report.subjectKind;
    const subjectId = messaging
      ? (subject.ownerId as string)
      : (subject.resolvedId ?? report.subjectId);
    const nextStatus = statusAfter(kind, report.status);

    const action = await this.db.$transaction(async (tx) => {
      const created = await tx.moderationAction.create({
        data: {
          moderatorId,
          kind,
          reportId: report.id,
          subjectKind,
          subjectId,
          note: note?.trim() || null,
        },
        select: ACTION_SELECT,
      });

      if (kind === "HIDE_SUBJECT" || kind === "RESTORE_SUBJECT") {
        const hiddenAt = kind === "HIDE_SUBJECT" ? created.createdAt : null;
        await this.applyHide(tx, report.subjectKind, subjectId, hiddenAt);
      }
      if (messaging) {
        await tx.user.update({
          where: { id: subjectId },
          data: {
            messagingRestrictedAt:
              kind === "RESTRICT_MESSAGING" ? created.createdAt : null,
          },
        });
      }

      if (nextStatus !== report.status) {
        const resolved = nextStatus !== "OPEN";
        await tx.memberReport.update({
          where: { id: report.id },
          data: {
            status: nextStatus,
            resolvedAt: resolved ? created.createdAt : null,
            resolvedById: resolved ? moderatorId : null,
          },
        });
      }
      return created;
    });

    const refreshed = await this.db.memberReport.findUniqueOrThrow({
      where: { id: report.id },
      select: REPORT_SELECT,
    });
    return {
      report: await this.toReport(moderatorId, refreshed),
      action: this.toActionRecord(action),
    };
  }

  /**
   * The hide itself, one column per subject kind. **Nothing is deleted**: the
   * routine keeps its days and its versions, the share keeps its token and
   * its `revokedAt`, the account keeps everything it owns and still reads its
   * own profile. A restore writes the same column back to null.
   */
  private async applyHide(
    tx: Prisma.TransactionClient,
    kind: ReportSubjectKind,
    subjectId: string,
    hiddenAt: Date | null,
  ): Promise<void> {
    if (kind === "MEMBER") {
      await tx.user.update({
        where: { id: subjectId },
        data: { moderationHiddenAt: hiddenAt },
      });
      return;
    }
    if (kind === "ROUTINE") {
      await tx.routine.update({
        where: { id: subjectId },
        data: { moderationHiddenAt: hiddenAt },
      });
      return;
    }
    if (kind === "COMMENT") {
      await tx.activityComment.update({
        where: { id: subjectId },
        data: { moderationHiddenAt: hiddenAt },
      });
      return;
    }
    if (kind === "MESSAGE") {
      // From the other participant only: its author keeps reading it.
      await tx.message.update({
        where: { id: subjectId },
        data: { moderationHiddenAt: hiddenAt },
      });
      return;
    }
    const { count } = await tx.sessionShare.updateMany({
      where: { token: subjectId },
      data: { moderationHiddenAt: hiddenAt },
    });
    if (count === 0)
      throw new NotFoundException(apiError("SHARE_LINK_NOT_FOUND"));
  }

  private async toReport(
    moderatorId: string,
    row: ReportRow,
  ): Promise<ModerationReport> {
    const subject = await this.resolveSubject(
      moderatorId,
      row.subjectKind,
      row.subjectId,
      row.id,
    );
    const otherOpenReports = await this.db.memberReport.count({
      where: {
        subjectKind: row.subjectKind,
        subjectId: row.subjectId,
        status: "OPEN",
        id: { not: row.id },
      },
    });
    return {
      id: row.id,
      status: row.status,
      reason: row.reason,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
      reporter: toMember(row.reporter),
      subject: toPreview(row.subjectKind, row.subjectId, subject),
      otherOpenReports,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }

  /**
   * What this moderator may learn about a reported subject, through the
   * shipped rules and nothing else. `readable` is the answer an ordinary
   * member in the same position would get -- so a hide the moderator
   * themselves put in place makes the subject unreadable to them too. That is
   * correct rather than awkward: the enforcement record, not a privileged
   * read, is how a decision is revisited.
   */
  private async resolveSubject(
    moderatorId: string,
    kind: ReportSubjectKind,
    reportedId: string,
    reportId: string,
  ): Promise<ResolvedSubjectDetail> {
    const missing: ResolvedSubjectDetail = {
      kind,
      resolvedId: null,
      ownerId: null,
      title: null,
      isHidden: false,
      owner: null,
      readable: false,
      messagingRestricted: null,
      messageGone: false,
    };
    const unrelated = { messagingRestricted: null, messageGone: false };

    if (kind === "MESSAGE") {
      // The report's own capture, not the live message: it outlives the
      // author deleting it and goes with the author's account.
      const capture = await this.db.reportedMessageCapture.findUnique({
        where: { reportId },
        select: {
          messageId: true,
          author: {
            select: { ...MEMBER_SELECT, messagingRestrictedAt: true },
          },
        },
      });
      if (!capture) return missing;
      const message = await this.db.message.findUnique({
        where: { id: capture.messageId },
        select: { deletedAt: true, moderationHiddenAt: true },
      });
      return {
        kind,
        resolvedId: capture.messageId,
        ownerId: capture.author.id,
        // The words are read only through the logged view.
        title: null,
        isHidden: message?.moderationHiddenAt != null,
        owner: capture.author,
        readable: true,
        messagingRestricted: capture.author.messagingRestrictedAt !== null,
        messageGone: message === null || message.deletedAt !== null,
      };
    }

    if (kind === "MEMBER") {
      const user = await this.db.user.findFirst({
        where: {
          OR: [{ id: reportedId }, { username: reportedId.toLowerCase() }],
        },
        select: {
          ...MEMBER_SELECT,
          moderationHiddenAt: true,
          messagingRestrictedAt: true,
        },
      });
      if (!user) return missing;
      const isOwner = user.id === moderatorId;
      // A profile has eight section rules rather than one, so "readable" here
      // is the prior question: whether the moderator could open the profile
      // at all. A hide or a block makes it 404 for them exactly as for
      // anyone; which sections they then see is `PROF-06`'s business on the
      // profile page itself.
      const blocked = isOwner
        ? 0
        : await this.db.userBlock.count({
            where: {
              OR: [
                { blockerId: moderatorId, blockedId: user.id },
                { blockerId: user.id, blockedId: moderatorId },
              ],
            },
          });
      return {
        kind,
        resolvedId: user.id,
        ownerId: user.id,
        title: user.username ? `@${user.username}` : user.name,
        isHidden: user.moderationHiddenAt !== null,
        owner: user,
        readable: isOwner || (!user.moderationHiddenAt && blocked === 0),
        messagingRestricted: user.messagingRestrictedAt !== null,
        messageGone: false,
      };
    }

    if (kind === "ROUTINE") {
      const routine = await this.db.routine.findUnique({
        where: { id: reportedId },
        select: {
          id: true,
          name: true,
          visibility: true,
          moderationHiddenAt: true,
          user: { select: { ...MEMBER_SELECT, routinesVisibility: true } },
        },
      });
      if (!routine) return missing;
      const isOwner = routine.user.id === moderatorId;
      const isFollower = isOwner
        ? false
        : (await this.db.userFollow.count({
            where: { followerId: moderatorId, followingId: routine.user.id },
          })) > 0;
      return {
        kind,
        resolvedId: routine.id,
        ownerId: routine.user.id,
        title: routine.name,
        isHidden: routine.moderationHiddenAt !== null,
        owner: routine.user,
        // ROUT-04's own rule, unchanged and unqualified.
        readable: canViewRoutine(
          routine.user.routinesVisibility,
          routine.visibility,
          { isOwner, isFollower },
          routine,
        ),
        ...unrelated,
      };
    }

    if (kind === "COMMENT") {
      const comment = await this.db.activityComment.findUnique({
        where: { id: reportedId },
        select: {
          id: true,
          body: true,
          moderationHiddenAt: true,
          user: { select: MEMBER_SELECT },
        },
      });
      if (!comment) return missing;
      const isOwner = comment.user.id === moderatorId;
      // SOC-06. A comment is readable to a reviewer when they could reach it
      // where it lives, which is the activity entry behind it -- and that
      // read is `ActivityService`'s, not this module's. Rather than build a
      // second answer to the same question here, the reviewer is shown the
      // comment only when nothing has hidden it: its own hide, or a block
      // either way with the member who wrote it. The entry's own audience is
      // settled where the reviewer opens it.
      const blocked = isOwner
        ? false
        : await isHiddenFromViewer(this.db, moderatorId, comment.user.id);
      const readable = isOwner || (!comment.moderationHiddenAt && !blocked);
      return {
        kind,
        resolvedId: comment.id,
        ownerId: comment.user.id,
        // The body is the content, so it is the title: a moderator reviewing
        // a reported comment needs to read the words to decide anything.
        title: comment.body,
        isHidden: comment.moderationHiddenAt !== null,
        owner: comment.user,
        readable,
        ...unrelated,
      };
    }

    const share = await this.db.sessionShare.findFirst({
      where: { token: reportedId },
      select: {
        token: true,
        revokedAt: true,
        moderationHiddenAt: true,
        user: { select: MEMBER_SELECT },
      },
    });
    if (!share) return missing;
    return {
      kind,
      resolvedId: share.token,
      ownerId: share.user.id,
      title: "Shared workout",
      isHidden: share.moderationHiddenAt !== null,
      owner: share.user,
      // SOC-07: the token is the credential, and the moderator holds it
      // because the reporter sent it. A revoked or hidden link resolves for
      // nobody, and that includes them.
      readable: share.revokedAt === null && share.moderationHiddenAt === null,
      ...unrelated,
    };
  }

  /** MSG-09: a message report's capture, for the logged view only. */
  private async messageContext(
    reportId: string,
  ): Promise<ReportedMessageContext | null> {
    const capture = await this.db.reportedMessageCapture.findUnique({
      where: { reportId },
      select: {
        messages: true,
        capturedAt: true,
        author: { select: MEMBER_SELECT },
      },
    });
    if (!capture) return null;
    return {
      author: toMember(capture.author),
      messages: readCapturedMessages(capture.messages),
      capturedAt: capture.capturedAt.toISOString(),
    };
  }

  private toActionRecord(row: ActionRow): ModerationActionRecord {
    return {
      id: row.id,
      kind: row.kind,
      moderator: toMember(row.moderator),
      reportId: row.reportId,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function toPreview(
  kind: ReportSubjectKind,
  reportedId: string,
  subject: ResolvedSubjectDetail,
): ReportSubjectPreview {
  return {
    kind,
    id: reportedId,
    resolvedId: subject.resolvedId,
    // Withheld means withheld. The title and the owner are the content, and a
    // queue that named them "for context" would be the bypass with extra
    // steps.
    title: subject.readable ? subject.title : null,
    owner: subject.readable && subject.owner ? toMember(subject.owner) : null,
    isMissing: subject.resolvedId === null,
    isWithheld: subject.resolvedId !== null && !subject.readable,
    isHidden: subject.isHidden,
    messagingRestricted: subject.messagingRestricted,
    messageGone: subject.messageGone,
  };
}

const REPORT_SELECT = {
  id: true,
  status: true,
  reason: true,
  details: true,
  createdAt: true,
  resolvedAt: true,
  subjectKind: true,
  subjectId: true,
  reporter: { select: MEMBER_SELECT },
} as const;

const ACTION_SELECT = {
  id: true,
  kind: true,
  reportId: true,
  subjectKind: true,
  subjectId: true,
  note: true,
  createdAt: true,
  moderator: { select: MEMBER_SELECT },
} as const;

type ReportRow = Prisma.MemberReportGetPayload<{
  select: typeof REPORT_SELECT;
}>;
type ActionRow = Prisma.ModerationActionGetPayload<{
  select: typeof ACTION_SELECT;
}>;
