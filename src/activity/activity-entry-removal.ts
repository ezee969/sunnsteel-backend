import { Prisma } from "@prisma/client";

/**
 * An activity entry is generated from its event, so an event that no
 * longer holds takes its entry away. What hung from that entry -- its
 * reactions, comments, their notifications and the owner's audience for it
 * -- was about a fact that did not happen, and goes with it.
 *
 * Used by the LIVE-17 correction and by the removal of stale record events.
 */
export async function removeActivityEntries(
  tx: Prisma.TransactionClient,
  userId: string,
  entryKeys: string[],
) {
  if (entryKeys.length === 0) return;
  const comments = await tx.activityComment.findMany({
    where: { entryKey: { in: entryKeys }, authorId: userId },
    select: { id: true },
  });
  if (comments.length)
    await tx.notification.deleteMany({
      where: {
        userId,
        sourceKey: { in: comments.map((comment) => `comment:${comment.id}`) },
      },
    });
  await tx.activityComment.deleteMany({
    where: { entryKey: { in: entryKeys }, authorId: userId },
  });
  await tx.activityEntryReaction.deleteMany({
    where: { entryKey: { in: entryKeys }, authorId: userId },
  });
  await tx.activityEntryOverride.deleteMany({
    where: { userId, entryKey: { in: entryKeys } },
  });
}
