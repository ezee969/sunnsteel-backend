import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  apiError,
  type CapturedMessage,
  type ConversationMessage,
  MESSAGE_REPORT_CONTEXT_BEFORE,
} from "@sunsteel/contracts";
import type { DatabaseService } from "../database/database.service";
import { isHiddenFromViewer } from "../users/member-blocks";
import {
  attachmentFor,
  type AttachmentKind,
  messageObjects,
  type MessageObjects,
  NO_OBJECTS,
} from "./message-attachments";

/**
 * MSG-09: what a moderator may do to messages, and what each participant
 * then reads. The pure rules first; the capture a report takes, with the
 * reporter's own `db`, last.
 */

export interface StoredMessage {
  id: string;
  senderId: string;
  body: string | null;
  deletedAt: Date | null;
  moderationHiddenAt: Date | null;
  /** MSG-07 and MSG-10: what it carries beside its text. */
  attachmentKind?: AttachmentKind | null;
  attachmentId?: string | null;
  createdAt: Date;
}

/**
 * Whether a participant reads a message's content at all: not once it is
 * deleted, nor while moderation hides it from them (its author still does).
 */
export function isReadableBy(row: StoredMessage, viewerId: string): boolean {
  if (row.deletedAt !== null) return false;
  return row.moderationHiddenAt === null || row.senderId === viewerId;
}

/**
 * One message as one participant reads it. A deleted message is "Message
 * deleted" for both; a message moderation hid keeps its text for its author,
 * who is told it is hidden, and loses it for the other participant, who reads
 * "Removed by moderation" (the owner's decision at claim).
 */
export function messageFor(
  row: StoredMessage,
  viewerId: string,
  objects: MessageObjects = NO_OBJECTS,
): ConversationMessage {
  const deleted = row.deletedAt !== null;
  const hidden = !deleted && row.moderationHiddenAt !== null;
  return {
    id: row.id,
    sentByMe: row.senderId === viewerId,
    body: isReadableBy(row, viewerId) ? row.body : null,
    deleted,
    hiddenByModeration: hidden,
    attachment: attachmentFor(row, viewerId, objects),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Why a participant may not report a message, or null when they may. Their
 * own message is a 400; a message they can no longer read -- deleted, or
 * already removed by moderation -- has nothing left to report.
 */
export function reportRefusal(
  row: StoredMessage,
  reporterId: string,
): "OWN" | "UNREADABLE" | null {
  if (row.senderId === reporterId) return "OWN";
  // MSG-07: a routine sent without a note has no text and is still readable.
  return isReadableBy(row, reporterId) ? null : "UNREADABLE";
}

/**
 * The capture: the reported message and up to `MESSAGE_REPORT_CONTEXT_BEFORE`
 * before it, oldest first, each exactly as the reporter could read it then.
 * `rows` is the reported message and the ones before it, in any order.
 */
export function captureMessages(
  rows: StoredMessage[],
  reportedId: string,
  reporterId: string,
  objects: MessageObjects = NO_OBJECTS,
): CapturedMessage[] {
  const ordered = [...rows].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const at = ordered.findIndex((row) => row.id === reportedId);
  if (at < 0) return [];
  return ordered
    .slice(Math.max(0, at - MESSAGE_REPORT_CONTEXT_BEFORE), at + 1)
    .map((row) => {
      const seen = messageFor(row, reporterId, objects);
      // MSG-07, MSG-10, MSG-11: what it carried, by the name the reporter saw,
      // empty when it was no longer available, and nothing more of it.
      const attachment = seen.attachment;
      const routineName =
        attachment?.kind === "ROUTINE"
          ? (attachment.routine?.name ?? "")
          : null;
      const workoutName =
        attachment?.kind === "WORKOUT"
          ? attachment.workout
            ? [attachment.workout.routineName, attachment.workout.dayName]
                .filter(Boolean)
                .join(" · ")
            : ""
          : null;
      const recordName =
        attachment?.kind === "RECORD"
          ? (attachment.record?.exerciseName ?? "")
          : null;
      return {
        id: row.id,
        fromReporter: row.senderId === reporterId,
        body: seen.body,
        deleted: seen.deleted,
        isReported: row.id === reportedId,
        routineName,
        workoutName,
        recordName,
        createdAt: seen.createdAt,
      };
    });
}

/** Reads a stored capture back, dropping anything that is not one. */
export function readCapturedMessages(value: unknown): CapturedMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is CapturedMessage =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as CapturedMessage).id === "string" &&
      typeof (item as CapturedMessage).fromReporter === "boolean" &&
      typeof (item as CapturedMessage).isReported === "boolean" &&
      typeof (item as CapturedMessage).createdAt === "string",
  );
}

const STORED_MESSAGE_SELECT = {
  id: true,
  senderId: true,
  body: true,
  deletedAt: true,
  moderationHiddenAt: true,
  attachmentKind: true,
  attachmentId: true,
  createdAt: true,
} as const;

export interface MessageCaptureData {
  messageId: string;
  conversationId: string;
  authorId: string;
  messages: CapturedMessage[];
}

type CaptureDb = Pick<
  DatabaseService,
  "message" | "userBlock" | "user" | "routine" | "workoutSession" | "$queryRaw"
>;

/**
 * What a report of `messageId` by `reporterId` captures. The reporter must be
 * in the conversation and able to read the message where it is -- after any
 * "delete conversation" of theirs, with no block or hide between the two --
 * or it answers 404, as the conversation itself would. The messages before it
 * are only the ones the reporter could still see, so a capture never holds
 * more than the reporter handed over.
 */
export async function captureReportedMessage(
  db: CaptureDb,
  reporterId: string,
  messageId: string,
): Promise<MessageCaptureData> {
  const notFound = () =>
    new NotFoundException(apiError("REPORT_SUBJECT_NOT_FOUND"));
  const message = await db.message.findFirst({
    where: {
      id: messageId,
      conversation: { participants: { some: { userId: reporterId } } },
    },
    select: {
      ...STORED_MESSAGE_SELECT,
      conversationId: true,
      conversation: {
        select: {
          participants: {
            where: { userId: reporterId },
            select: { clearedAt: true },
          },
        },
      },
    },
  });
  if (!message) throw notFound();
  const refusal = reportRefusal(message, reporterId);
  if (refusal === "OWN") {
    throw new BadRequestException(apiError("REPORT_OWN_MESSAGE"));
  }
  const clearedAt = message.conversation.participants[0]?.clearedAt ?? null;
  if (
    refusal === "UNREADABLE" ||
    (clearedAt !== null && message.createdAt <= clearedAt) ||
    (await isHiddenFromViewer(db, reporterId, message.senderId))
  ) {
    throw notFound();
  }
  const before = await db.message.findMany({
    where: {
      conversationId: message.conversationId,
      AND: [
        clearedAt ? { createdAt: { gt: clearedAt } } : {},
        {
          OR: [
            { createdAt: { lt: message.createdAt } },
            { createdAt: message.createdAt, id: { lt: message.id } },
          ],
        },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGE_REPORT_CONTEXT_BEFORE,
    select: STORED_MESSAGE_SELECT,
  });
  const rows = [...before, message];
  return {
    messageId: message.id,
    conversationId: message.conversationId,
    authorId: message.senderId,
    messages: captureMessages(
      rows,
      message.id,
      reporterId,
      await messageObjects(db, rows),
    ),
  };
}
