import { NotFoundException } from "@nestjs/common";
import {
  apiError,
  type MessageAttachment,
  type SharedRoutine,
  type SharedRoutineSummary,
} from "@sunsteel/contracts";
import type { DatabaseService } from "../database/database.service";
import { withoutOwnersBlocks } from "../routines/linear-periodization";
import { ROUTINE_WITH_DAYS_SELECT } from "../routines/routine.selects";
import {
  ROUTINE_SUMMARY_SELECT,
  toSharedRoutineSummary,
} from "../routines/routine-summary";
import { captureRoutineSetup } from "../routines/routine-versions";
import { isHiddenFromViewer } from "../users/member-blocks";

/**
 * MSG-07: a routine in a message. Sending it is the sender's consent, like a
 * `ROUT-04` link, to the conversation's other participant: they may open and
 * clone it whatever its visibility, until the message is deleted. Nothing of
 * the routine is copied into the message; the card and the routine are read
 * as they are now, so an edit shows and a deleted or hidden routine reads as
 * no longer available.
 */

export interface AttachmentRef {
  senderId: string;
  attachmentKind?: "ROUTINE" | null;
  attachmentId?: string | null;
}

/** The routines a page of messages carries, keyed by id, as they are now. */
export type MessageRoutines = ReadonlyMap<string, SharedRoutineSummary>;

/**
 * Whether the viewer reads what a message carries: never once it is deleted,
 * nor while moderation hides it from them (its author still does). The same
 * rule as its text.
 */
export function attachmentFor(
  row: AttachmentRef & {
    deletedAt: Date | null;
    moderationHiddenAt: Date | null;
  },
  viewerId: string,
  routines: MessageRoutines,
): MessageAttachment | null {
  if (row.attachmentKind !== "ROUTINE" || !row.attachmentId) return null;
  if (row.deletedAt !== null) return null;
  if (row.moderationHiddenAt !== null && row.senderId !== viewerId) return null;
  return { kind: "ROUTINE", routine: routines.get(row.attachmentId) ?? null };
}

type RoutineDb = Pick<DatabaseService, "routine">;

/**
 * The routines some messages carry, read once for the page. A routine counts
 * only while it is still its sender's and moderation has not hidden it: a
 * hide is "hidden from everyone", and a message must not be a way around it.
 */
export async function messageRoutines(
  db: RoutineDb,
  rows: AttachmentRef[],
): Promise<MessageRoutines> {
  const wanted = new Map<string, string>();
  for (const row of rows) {
    if (row.attachmentKind === "ROUTINE" && row.attachmentId) {
      wanted.set(row.attachmentId, row.senderId);
    }
  }
  if (wanted.size === 0) return new Map();
  const routines = await db.routine.findMany({
    where: { id: { in: [...wanted.keys()] }, moderationHiddenAt: null },
    select: { ...ROUTINE_SUMMARY_SELECT, userId: true },
  });
  return new Map(
    routines
      .filter((routine) => wanted.get(routine.id) === routine.userId)
      .map((routine) => [routine.id, toSharedRoutineSummary(routine)]),
  );
}

/**
 * Whether a member may send this routine: only their own, and not one
 * moderation hid. Anything else is the 404 a routine they cannot see gets.
 */
export async function assertSendableRoutine(
  db: RoutineDb,
  senderId: string,
  routineId: string,
): Promise<void> {
  const routine = await db.routine.findFirst({
    where: { id: routineId, userId: senderId, moderationHiddenAt: null },
    select: { id: true },
  });
  if (!routine) throw new NotFoundException(apiError("ROUTINE_NOT_FOUND"));
}

const OWNER_SELECT = {
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
} as const;

type ReadDb = Pick<
  DatabaseService,
  "message" | "routine" | "userBlock" | "user"
>;

/**
 * The routine a message shared, in full, for a participant who can still read
 * that message where it is: after their own "delete conversation", while it is
 * neither deleted nor hidden from them, and with no block or hide between the
 * two -- the conversation's own gate. Every refusal is the same 404, so a
 * message cannot be used to learn whether a routine exists.
 */
export async function readMessageRoutine(
  db: ReadDb,
  viewerId: string,
  messageId: string,
  conversationId?: string,
): Promise<SharedRoutine> {
  const notFound = () => new NotFoundException(apiError("ROUTINE_NOT_FOUND"));
  const message = await db.message.findFirst({
    where: {
      id: messageId,
      ...(conversationId ? { conversationId } : {}),
      conversation: { participants: { some: { userId: viewerId } } },
    },
    select: {
      senderId: true,
      deletedAt: true,
      moderationHiddenAt: true,
      createdAt: true,
      attachmentKind: true,
      attachmentId: true,
      conversation: {
        select: { participants: { select: { userId: true, clearedAt: true } } },
      },
    },
  });
  if (!message) throw notFound();
  const attachment = attachmentFor(message, viewerId, new Map());
  if (!attachment || !message.attachmentId) throw notFound();
  const mine = message.conversation.participants.find(
    (row) => row.userId === viewerId,
  );
  if (mine?.clearedAt && message.createdAt <= mine.clearedAt) throw notFound();
  const other = message.conversation.participants.find(
    (row) => row.userId !== viewerId,
  );
  if (other && (await isHiddenFromViewer(db, viewerId, other.userId))) {
    throw notFound();
  }

  const routine = await db.routine.findFirst({
    where: {
      id: message.attachmentId,
      userId: message.senderId,
      moderationHiddenAt: null,
    },
    select: { ...ROUTINE_WITH_DAYS_SELECT, user: { select: OWNER_SELECT } },
  });
  if (!routine) throw notFound();
  return {
    routineId: routine.id,
    setup: withoutOwnersBlocks(captureRoutineSetup(routine)),
    owner: {
      username: routine.user.username ?? "",
      name: routine.user.name,
      lastName: routine.user.lastName,
      avatarUrl: routine.user.avatarUrl,
    },
    source: "MESSAGE",
    updatedAt: routine.updatedAt.toISOString(),
  };
}
