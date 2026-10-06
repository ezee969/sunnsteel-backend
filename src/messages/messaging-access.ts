import type {
  MemberMessagingState,
  MessagePermission,
} from "@sunsteel/contracts";
import type { DatabaseService } from "../database/database.service";
import { admissionFor, conversationPairKey } from "./message-rules";

type MessagingDb = Pick<
  DatabaseService,
  "conversation" | "userFollow" | "user"
>;

/**
 * MSG-01: what a member profile tells its viewer about messaging -- whether
 * a Message action shows and the conversation it opens. Asked only after the
 * profile read has refused a block or a hidden member with its 404, and with
 * the read's own `db`, as the `PROF-10` helpers are. The same `maySendTo`
 * decides the write, so the button and the server cannot disagree.
 */
export async function messagingStateFor(
  db: MessagingDb,
  viewerId: string,
  target: { id: string; messagePermission: MessagePermission },
): Promise<MemberMessagingState> {
  const [conversation, follow, hidden, restricted] = await Promise.all([
    db.conversation.findUnique({
      where: { pairKey: conversationPairKey(viewerId, target.id) },
      select: { id: true, _count: { select: { participants: true } } },
    }),
    db.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId: target.id,
          followingId: viewerId,
        },
      },
      select: { followerId: true },
    }),
    // Counts, like TRUST-04's hide check: they read nothing about the account
    // but whether a hide (TRUST-04) or a restriction (MSG-09) stands.
    db.user.count({
      where: { id: viewerId, moderationHiddenAt: { not: null } },
    }),
    db.user.count({
      where: { id: viewerId, messagingRestrictedAt: { not: null } },
    }),
  ]);
  const shared =
    conversation && conversation._count.participants === 2
      ? conversation.id
      : null;
  const admission = admissionFor({
    permission: target.messagePermission,
    recipientFollowsSender: follow !== null,
    hasConversation: shared !== null,
    senderHidden: hidden > 0,
    senderRestricted: restricted > 0,
  });
  return {
    canStart: admission !== "REFUSED",
    conversationId: shared,
    // MSG-02: the first message would land in their Requests.
    asRequest: admission === "REQUEST",
  };
}

type DeletionTx = {
  message: Pick<DatabaseService["message"], "deleteMany">;
  conversation: Pick<DatabaseService["conversation"], "deleteMany">;
};

/**
 * MSG-01 and TRUST-01, inside the account deletion's transaction: a deleted
 * member's conversations are emptied on both sides (the owner's decision 8),
 * so the other participant keeps an empty conversation with "Deleted member".
 * The member's own messages and participant rows would cascade anyway; the
 * other side's are removed here, and a conversation nobody else is left in
 * goes with them.
 */
export async function clearConversationsOf(
  tx: DeletionTx,
  userId: string,
): Promise<void> {
  await tx.message.deleteMany({
    where: { conversation: { participants: { some: { userId } } } },
  });
  await tx.conversation.deleteMany({
    where: { participants: { every: { userId } } },
  });
}
