import {
  type ConversationRequest,
  MESSAGE_REQUEST_DECLINE_COOLDOWN_DAYS,
  type MessagePermission,
} from "@sunsteel/contracts";

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
  return admissionFor(facts) !== "REFUSED";
}

/**
 * MSG-02: where a would-be sender's first message goes. A member the
 * recipient follows reaches the inbox under either setting that admits them;
 * under Everyone anyone else's lands in Requests; Nobody refuses both.
 */
export function admissionFor(
  facts: StartFacts,
): "INBOX" | "REQUEST" | "REFUSED" {
  if (facts.senderHidden || facts.senderRestricted) return "REFUSED";
  if (facts.hasConversation) return "INBOX";
  if (facts.permission === "NOBODY") return "REFUSED";
  if (facts.recipientFollowsSender) return "INBOX";
  return facts.permission === "EVERYONE" ? "REQUEST" : "REFUSED";
}

export type ConversationStatus = "ACCEPTED" | "PENDING" | "DECLINED";

export interface RequestSendFacts {
  status: ConversationStatus;
  /** The viewer sent the request (`startedById`). */
  viewerIsRequester: boolean;
  /** The other member follows the viewer. */
  otherFollowsViewer: boolean;
  /** The other member's own setting. */
  otherPermission: MessagePermission;
  declinedAt: Date | null;
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * MSG-02: what a message into a conversation does while it is a request (the
 * owner's decisions at claim). Its recipient writing accepts it. Its sender
 * waits after the first message, unless the recipient follows them now; after
 * a decline they may ask again only after 30 days and only while the
 * recipient still lets everyone in -- and are refused with the ordinary "not
 * taking messages" answer, so a decline is never told.
 */
export function requestSendOutcome(
  facts: RequestSendFacts,
): "SEND" | "ACCEPT_AND_SEND" | "PENDING" | "REFUSED" | "REREQUEST" {
  if (facts.status === "ACCEPTED") return "SEND";
  if (!facts.viewerIsRequester) return "ACCEPT_AND_SEND";
  if (facts.otherFollowsViewer && facts.otherPermission !== "NOBODY") {
    return "ACCEPT_AND_SEND";
  }
  if (facts.status === "PENDING") return "PENDING";
  if (facts.otherPermission !== "EVERYONE") return "REFUSED";
  const waited =
    facts.declinedAt === null ||
    facts.now.getTime() - facts.declinedAt.getTime() >=
      MESSAGE_REQUEST_DECLINE_COOLDOWN_DAYS * DAY_MS;
  return waited ? "REREQUEST" : "REFUSED";
}

/**
 * MSG-02: how a request reads for one participant. Its sender sees it waiting
 * whether it is pending or declined; its recipient sees it until it is
 * accepted.
 */
export function requestFor(
  status: ConversationStatus,
  viewerIsRequester: boolean,
): ConversationRequest | null {
  if (status === "ACCEPTED") return null;
  return { direction: viewerIsRequester ? "OUTGOING" : "INCOMING" };
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

/**
 * MSG-08: whether a new message may schedule a push to its recipient. A
 * conversation pushes once until it is read (the owner's decision): never
 * pushed, or read since the last push.
 */
export function maySchedulePush(
  lastPushedAt: Date | null,
  cutoff: Date | null,
): boolean {
  if (lastPushedAt === null) return true;
  return cutoff !== null && cutoff.getTime() >= lastPushedAt.getTime();
}

/**
 * MSG-08: whether a waiting push still goes out when it falls due. It goes
 * while the newest message from the other member is unread, so one written
 * after the recipient read the earlier ones still reaches them; it is
 * dropped once they have read it (the owner's decision: a live conversation
 * does not buzz), and when the conversation is no longer theirs to read --
 * gone, a request again, or a block or a hide between the two.
 */
export function messagePushStillDue(facts: {
  /** Null when the recipient is no longer in the conversation. */
  cutoff: Date | null | undefined;
  /** The other member's newest message they can still read, if any. */
  newestFromThem: Date | null;
  status: ConversationStatus | null;
  hidden: boolean;
}): boolean {
  if (facts.cutoff === undefined || facts.status !== "ACCEPTED") return false;
  if (facts.hidden || facts.newestFromThem === null) return false;
  return (
    facts.cutoff === null ||
    facts.cutoff.getTime() < facts.newestFromThem.getTime()
  );
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
