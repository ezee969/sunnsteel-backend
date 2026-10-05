import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  apiError,
  CONVERSATIONS_PAGE_SIZE,
  type ConversationMessage,
  type ConversationMessagesResponse,
  type ConversationsResponse,
  type ConversationSummary,
  MESSAGE_BODY_MAX,
  MESSAGES_PAGE_SIZE,
  MESSAGES_PER_MINUTE_MAX,
  NEW_CONVERSATIONS_PER_DAY_MAX,
  normalizeMessageBody,
  type SendMessageRequest,
  type SendMessageResponse,
  type StartConversationRequest,
} from "@sunsteel/contracts";
import { DatabaseService } from "../database/database.service";
import { hiddenFromViewer, isHiddenFromViewer } from "../users/member-blocks";
import { normalizeUsername } from "../users/username";
import {
  conversationPairKey,
  decodeKeysetCursor,
  encodeKeysetCursor,
  isAbandoned,
  maySendTo,
  utcWallClock,
} from "./message-rules";

const MEMBER_SELECT = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
} as const satisfies Prisma.UserSelect;

const MESSAGE_SELECT = {
  id: true,
  senderId: true,
  body: true,
  deletedAt: true,
  createdAt: true,
} as const satisfies Prisma.MessageSelect;

type MemberRow = Prisma.UserGetPayload<{ select: typeof MEMBER_SELECT }>;
type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

interface OpenConversation {
  id: string;
  lastMessageAt: Date;
  clearedAt: Date | null;
  /** Null once the other member deleted their account. */
  other: MemberRow | null;
  viewerHidden: boolean;
}

function toMessage(row: MessageRow, viewerId: string): ConversationMessage {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    sentByMe: row.senderId === viewerId,
    body: deleted ? null : row.body,
    deleted,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isMissingRecord(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

/**
 * MSG-01: one-to-one conversations of text.
 *
 * Every read and write starts from the participant row and asks the shared
 * `PROF-10`/`TRUST-04` helpers about the other member, so a block hides a
 * conversation from both sides while it lasts and a hidden member is
 * unreachable; both answer 404, as a blocked profile does. Who may *start*
 * a conversation is the recipient's setting, through `maySendTo`; once a
 * conversation exists it keeps working. A participant who deletes it hides
 * what was sent until then from themselves only, and once every participant
 * has, the conversation is removed.
 */
@Injectable()
export class MessagesService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    viewerId: string,
    cursorText?: string,
  ): Promise<ConversationsResponse> {
    const cursor = cursorText ? decodeKeysetCursor(cursorText) : null;
    if (cursorText && !cursor) throw new BadRequestException("Invalid cursor");
    const [hidden, viewerHidden] = await Promise.all([
      hiddenFromViewer(this.db, viewerId),
      this.isViewerHidden(viewerId),
    ]);
    const take = CONVERSATIONS_PAGE_SIZE;
    const rows = await this.db.$queryRaw<
      Array<{ id: string; lastMessageAt: Date; clearedAt: Date | null }>
    >`
      SELECT c."id", c."lastMessageAt", p."clearedAt"
      FROM "ConversationParticipant" p
      JOIN "Conversation" c ON c."id" = p."conversationId"
      WHERE p."userId" = ${viewerId}
        AND (p."clearedAt" IS NULL OR c."lastMessageAt" > p."clearedAt")
        AND NOT EXISTS (
          SELECT 1 FROM "ConversationParticipant" o
          WHERE o."conversationId" = c."id" AND o."userId" = ANY(${hidden}::text[])
        )
        ${
          cursor
            ? Prisma.sql`AND (c."lastMessageAt", c."id") < (${utcWallClock(cursor.at)}::timestamp, ${cursor.id})`
            : Prisma.empty
        }
      ORDER BY c."lastMessageAt" DESC, c."id" DESC
      LIMIT ${take + 1}
    `;
    const page = rows.slice(0, take);
    const others = await this.otherMembers(
      page.map((row) => row.id),
      viewerId,
    );
    const conversations = await Promise.all(
      page.map(async (row) =>
        this.summary(
          {
            id: row.id,
            lastMessageAt: row.lastMessageAt,
            clearedAt: row.clearedAt,
            other: others.get(row.id) ?? null,
            viewerHidden,
          },
          viewerId,
        ),
      ),
    );
    const last = page.at(-1);
    return {
      conversations,
      nextCursor:
        rows.length > take && last
          ? encodeKeysetCursor({ at: last.lastMessageAt, id: last.id })
          : null,
    };
  }

  async messages(
    viewerId: string,
    conversationId: string,
    cursorText?: string,
  ): Promise<ConversationMessagesResponse> {
    const cursor = cursorText ? decodeKeysetCursor(cursorText) : null;
    if (cursorText && !cursor) throw new BadRequestException("Invalid cursor");
    const open = await this.open(viewerId, conversationId);
    const take = MESSAGES_PAGE_SIZE;
    const rows = await this.db.message.findMany({
      where: {
        conversationId,
        AND: [
          open.clearedAt ? { createdAt: { gt: open.clearedAt } } : {},
          cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.at } },
                  { createdAt: cursor.at, id: { lt: cursor.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      select: MESSAGE_SELECT,
    });
    const page = rows.slice(0, take);
    const last = page.at(-1);
    return {
      conversation: await this.summary(open, viewerId),
      messages: page.map((row) => toMessage(row, viewerId)),
      nextCursor:
        rows.length > take && last
          ? encodeKeysetCursor({ at: last.createdAt, id: last.id })
          : null,
    };
  }

  /**
   * Starts a conversation with its first message, or sends into the one the
   * pair already has. The recipient's setting is asked only when there is
   * none yet.
   */
  async start(
    viewerId: string,
    request: StartConversationRequest,
  ): Promise<SendMessageResponse> {
    const body = this.body(request.body);
    const recipient = await this.db.user.findFirst({
      where: {
        OR: [
          { id: request.recipient },
          { username: normalizeUsername(request.recipient) },
        ],
      },
      select: { id: true, messagePermission: true },
    });
    if (!recipient) throw new NotFoundException(apiError("MEMBER_NOT_FOUND"));
    if (recipient.id === viewerId) {
      throw new BadRequestException(apiError("MESSAGE_SELF"));
    }
    if (await isHiddenFromViewer(this.db, viewerId, recipient.id)) {
      throw new NotFoundException(apiError("MEMBER_NOT_FOUND"));
    }
    const pairKey = conversationPairKey(viewerId, recipient.id);
    const existing = await this.db.conversation.findUnique({
      where: { pairKey },
      select: { id: true, participants: { select: { userId: true } } },
    });
    if (existing && existing.participants.length === 2) {
      return this.send(viewerId, existing.id, request);
    }

    const [viewerHidden, follow] = await Promise.all([
      this.isViewerHidden(viewerId),
      this.db.userFollow.findUnique({
        where: {
          followerId_followingId: {
            followerId: recipient.id,
            followingId: viewerId,
          },
        },
        select: { followerId: true },
      }),
    ]);
    if (viewerHidden) {
      throw new ForbiddenException(apiError("MESSAGING_UNAVAILABLE"));
    }
    if (
      !maySendTo({
        permission: recipient.messagePermission,
        recipientFollowsSender: follow !== null,
        hasConversation: false,
        senderHidden: false,
      })
    ) {
      throw new ForbiddenException(apiError("MESSAGE_NOT_ADMITTED"));
    }
    const now = new Date();
    const startedToday = await this.db.conversation.count({
      where: {
        startedById: viewerId,
        createdAt: { gte: new Date(now.getTime() - DAY_MS) },
      },
    });
    if (startedToday >= NEW_CONVERSATIONS_PER_DAY_MAX) {
      throw new HttpException(
        apiError("CONVERSATIONS_PER_DAY", {
          max: NEW_CONVERSATIONS_PER_DAY_MAX,
        }),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.assertSendRate(viewerId, now);

    let created: { id: string; messages: MessageRow[] };
    try {
      created = await this.db.$transaction(async (tx) => {
        // A pair key left by a conversation whose other side is gone cannot
        // belong to these two accounts, but never let it block a new one.
        if (existing)
          await tx.conversation.delete({ where: { id: existing.id } });
        return tx.conversation.create({
          data: {
            pairKey,
            startedById: viewerId,
            createdAt: now,
            lastMessageAt: now,
            participants: {
              create: [{ userId: viewerId }, { userId: recipient.id }],
            },
            messages: {
              create: { senderId: viewerId, body, createdAt: now },
            },
          },
          select: { id: true, messages: { select: MESSAGE_SELECT } },
        });
      });
    } catch (error) {
      // Both members started one at the same moment: send into theirs.
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.db.conversation.findUnique({
        where: { pairKey },
        select: { id: true },
      });
      if (!raced) throw error;
      return this.send(viewerId, raced.id, request);
    }
    const open = await this.open(viewerId, created.id);
    const message = toMessage(created.messages[0], viewerId);
    return {
      conversation: await this.summary(open, viewerId, message),
      message,
    };
  }

  async send(
    viewerId: string,
    conversationId: string,
    request: SendMessageRequest,
  ): Promise<SendMessageResponse> {
    const body = this.body(request.body);
    const open = await this.open(viewerId, conversationId);
    if (open.viewerHidden) {
      throw new ForbiddenException(apiError("MESSAGING_UNAVAILABLE"));
    }
    if (!open.other)
      throw new ConflictException(apiError("CONVERSATION_CLOSED"));
    const now = new Date();
    await this.assertSendRate(viewerId, now);
    let row: MessageRow;
    try {
      row = await this.db.$transaction(async (tx) => {
        // Taking the conversation's row first serializes a send against a
        // participant deleting it, so a new message is never lost to a
        // removal that read the old `lastMessageAt`.
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: now },
        });
        return tx.message.create({
          data: { conversationId, senderId: viewerId, body, createdAt: now },
          select: MESSAGE_SELECT,
        });
      });
    } catch (error) {
      if (isMissingRecord(error)) {
        throw new NotFoundException(apiError("CONVERSATION_NOT_FOUND"));
      }
      throw error;
    }
    const message = toMessage(row, viewerId);
    return {
      conversation: await this.summary(
        { ...open, lastMessageAt: now },
        viewerId,
        message,
      ),
      message,
    };
  }

  /** Deletes the viewer's own message for both; its place stays. */
  async deleteMessage(
    viewerId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ConversationMessage> {
    await this.open(viewerId, conversationId);
    const row = await this.db.message.findFirst({
      where: { id: messageId, conversationId, senderId: viewerId },
      select: MESSAGE_SELECT,
    });
    if (!row) throw new NotFoundException(apiError("MESSAGE_NOT_FOUND"));
    if (row.deletedAt) return toMessage(row, viewerId);
    const updated = await this.db.message.update({
      where: { id: messageId },
      data: { body: null, deletedAt: new Date() },
      select: MESSAGE_SELECT,
    });
    return toMessage(updated, viewerId);
  }

  /**
   * Deletes the conversation from the viewer's list: what was sent until now
   * is hidden from them only. When every participant has done so since its
   * newest message, the conversation and its messages are removed.
   */
  async deleteConversation(
    viewerId: string,
    conversationId: string,
  ): Promise<void> {
    await this.open(viewerId, conversationId);
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ lastMessageAt: Date }>>`
        SELECT "lastMessageAt" FROM "Conversation" WHERE "id" = ${conversationId} FOR UPDATE
      `;
      if (locked.length === 0) return;
      // Never before the newest message: deleting hides everything already
      // in it, whatever the clocks that stamped them said.
      const clearedAt = new Date(
        Math.max(now.getTime(), locked[0].lastMessageAt.getTime()),
      );
      await tx.conversationParticipant.update({
        where: { conversationId_userId: { conversationId, userId: viewerId } },
        data: { clearedAt },
      });
      const participants = await tx.conversationParticipant.findMany({
        where: { conversationId },
        select: { clearedAt: true },
      });
      if (isAbandoned(participants, locked[0].lastMessageAt)) {
        await tx.conversation.delete({ where: { id: conversationId } });
      }
    });
  }

  /**
   * The viewer's participant row and the other member, or a 404 when the
   * viewer is not in it, or a block or a moderation hide stands between them.
   */
  private async open(
    viewerId: string,
    conversationId: string,
  ): Promise<OpenConversation> {
    const conversation = await this.db.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { some: { userId: viewerId } },
      },
      select: {
        id: true,
        lastMessageAt: true,
        participants: {
          select: {
            userId: true,
            clearedAt: true,
            user: { select: MEMBER_SELECT },
          },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException(apiError("CONVERSATION_NOT_FOUND"));
    }
    const mine = conversation.participants.find(
      (row) => row.userId === viewerId,
    );
    const other = conversation.participants.find(
      (row) => row.userId !== viewerId,
    );
    if (other && (await isHiddenFromViewer(this.db, viewerId, other.userId))) {
      throw new NotFoundException(apiError("CONVERSATION_NOT_FOUND"));
    }
    return {
      id: conversation.id,
      lastMessageAt: conversation.lastMessageAt,
      clearedAt: mine?.clearedAt ?? null,
      other: other?.user ?? null,
      viewerHidden: await this.isViewerHidden(viewerId),
    };
  }

  private async summary(
    open: OpenConversation,
    viewerId: string,
    lastMessage?: ConversationMessage,
  ): Promise<ConversationSummary> {
    let newest = lastMessage ?? null;
    if (!newest) {
      const row = await this.db.message.findFirst({
        where: {
          conversationId: open.id,
          ...(open.clearedAt ? { createdAt: { gt: open.clearedAt } } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: MESSAGE_SELECT,
      });
      newest = row ? toMessage(row, viewerId) : null;
    }
    return {
      id: open.id,
      counterpart: open.other
        ? {
            id: open.other.id,
            username: open.other.username,
            name: open.other.name,
            avatarUrl: open.other.avatarUrl,
          }
        : null,
      lastMessage: newest,
      lastMessageAt: newest ? open.lastMessageAt.toISOString() : null,
      canSend: open.other !== null && !open.viewerHidden,
    };
  }

  private async otherMembers(
    conversationIds: string[],
    viewerId: string,
  ): Promise<Map<string, MemberRow>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.db.conversationParticipant.findMany({
      where: {
        conversationId: { in: conversationIds },
        userId: { not: viewerId },
      },
      select: { conversationId: true, user: { select: MEMBER_SELECT } },
    });
    return new Map(rows.map((row) => [row.conversationId, row.user]));
  }

  private async isViewerHidden(viewerId: string): Promise<boolean> {
    const viewer = await this.db.user.findUnique({
      where: { id: viewerId },
      select: { moderationHiddenAt: true },
    });
    return viewer?.moderationHiddenAt != null;
  }

  private body(text: string): string {
    const body = normalizeMessageBody(text);
    if (!body) {
      throw new BadRequestException(
        apiError("MESSAGE_LENGTH", { max: MESSAGE_BODY_MAX }),
      );
    }
    return body;
  }

  private async assertSendRate(viewerId: string, now: Date): Promise<void> {
    const sent = await this.db.message.count({
      where: {
        senderId: viewerId,
        createdAt: { gte: new Date(now.getTime() - MINUTE_MS) },
      },
    });
    if (sent >= MESSAGES_PER_MINUTE_MAX) {
      throw new HttpException(
        apiError("MESSAGES_PER_MINUTE", { max: MESSAGES_PER_MINUTE_MAX }),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
