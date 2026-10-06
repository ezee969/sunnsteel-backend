import type { MessagePermission } from "@sunsteel/contracts";

/**
 * MSG-01: the pure rules of direct messages. Who may start a conversation,
 * what a participant still sees after deleting one, and the keyset cursors.
 * The service reads the facts and asks these.
 */

/** The two account ids sorted and joined, as SOC-08's partnership does. */
export function conversationPairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export interface StartFacts {
  /** The recipient's own setting. */
  permission: MessagePermission;
  /** Whether the recipient follows the would-be sender. */
  recipientFollowsSender: boolean;
  /** Whether the pair already has a conversation both are still in. */
  hasConversation: boolean;
  /** TRUST-04: the sender is hidden by moderation and messages no one. */
  senderHidden: boolean;
  /** MSG-09: moderation restricted the sender's messaging until lifted. */
  senderRestricted: boolean;
}

/**
 * Whether the viewer may start (or carry on) a conversation. The recipient's
 * setting decides only who may start one: an existing conversation keeps
 * working whatever the setting says now, and blocking is the control for
 * that (owner, 2026-10-05). Blocks and hidden recipients are refused before
 * this is asked, with a 404.
 */
export function maySendTo(facts: StartFacts): boolean {
  if (facts.senderHidden || facts.senderRestricted) return false;
  if (facts.hasConversation) return true;
  if (facts.permission === "NOBODY") return false;
  return facts.recipientFollowsSender;
}

/**
 * Whether a participant still lists a conversation: never deleted, or a
 * message arrived after they deleted it.
 */
export function isListed(clearedAt: Date | null, lastMessageAt: Date): boolean {
  return clearedAt === null || lastMessageAt.getTime() > clearedAt.getTime();
}

/**
 * Whether a conversation can be removed for good: every participant still in
 * it has deleted it since its newest message (a deleted member's row is
 * already gone). The owner's retention rule.
 */
export function isAbandoned(
  participants: Array<{ clearedAt: Date | null }>,
  lastMessageAt: Date,
): boolean {
  return participants.every(
    (participant) => !isListed(participant.clearedAt, lastMessageAt),
  );
}

/**
 * MSG-03: where a reader's unread starts -- their read position or their
 * "delete conversation", whichever is later -- or null when neither was ever
 * set, so everything the other member wrote is new.
 */
export function unreadCutoff(
  lastReadAt: Date | null,
  clearedAt: Date | null,
): Date | null {
  if (!lastReadAt) return clearedAt;
  if (!clearedAt) return lastReadAt;
  return lastReadAt > clearedAt ? lastReadAt : clearedAt;
}

/**
 * MSG-03: a read position only moves forward. The new position, or null when
 * the message seen is not after the one already read up to -- a tab showing
 * an older page must never make a newer message unread again.
 */
export function nextReadPosition(
  current: Date | null,
  seen: Date,
): Date | null {
  return current && current.getTime() >= seen.getTime() ? null : seen;
}

export interface KeysetCursor {
  at: Date;
  id: string;
}

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`).toString(
    "base64url",
  );
}

export function decodeKeysetCursor(value: string): KeysetCursor | null {
  let text: string;
  try {
    text = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const separator = text.indexOf("|");
  if (separator < 0) return null;
  const at = new Date(text.slice(0, separator));
  const id = text.slice(separator + 1);
  if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at, id };
}

/**
 * A `timestamp(3)` column compared in raw SQL takes the UTC wall clock as
 * text cast to `timestamp`; a `Date` parameter would be shifted by the
 * session's zone (the NAV-01 cursor loop).
 */
export function utcWallClock(at: Date): string {
  return at.toISOString().replace("Z", "");
}
