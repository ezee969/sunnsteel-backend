import type {
  MemberMessagingState,
  MessagePermission,
} from "@sunsteel/contracts";
import type { DatabaseService } from "../database/database.service";
import { conversationPairKey, maySendTo } from "./message-rules";

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
  const [conversation, follow, viewerHidden] = await Promise.all([
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
    // A count, like TRUST-04's hide check: it reads nothing about the account
    // but whether a hide stands.
    db.user.count({
      where: { id: viewerId, moderationHiddenAt: { not: null } },
    }),
  ]);
  const shared =
    conversation && conversation._count.participants === 2
      ? conversation.id
      : null;
  return {
    canStart: maySendTo({
      permission: target.messagePermission,
      recipientFollowsSender: follow !== null,
      hasConversation: shared !== null,
      senderHidden: viewerHidden > 0,
    }),
    conversationId: shared,
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
