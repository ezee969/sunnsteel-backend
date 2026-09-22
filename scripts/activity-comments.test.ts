import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACTIVITY_COMMENT_MAX_LENGTH,
  ACTIVITY_COMMENTS_PAGE_SIZE,
  ACTIVITY_COMMENTS_PER_DAY_MAX,
} from '@sunsteel/contracts';
import {
  canDeleteComment,
  commentPageSize,
  decodeCommentCursor,
  emptyCommentSummary,
  encodeCommentCursor,
  normalizeCommentBody,
  summarizeComments,
} from '../src/activity/activity-rules';
import { gatherNotifications } from '../src/notifications/notification-sources';

describe('SOC-06 who may delete a comment', () => {
  const comment = { userId: 'writer', authorId: 'owner' };

  it('lets the member who wrote it delete it', () => {
    assert.equal(canDeleteComment(comment, 'writer'), true);
  });

  it('lets the owner of the activity delete it', () => {
    // It is their workout it is attached to; a comment on it they could not
    // remove would make their own entry somebody else's surface.
    assert.equal(canDeleteComment(comment, 'owner'), true);
  });

  it('lets nobody else, including a moderator', () => {
    // TRUST-04 hides rather than deletes, so the enforcement record stays the
    // only account of what a moderator did and nothing they touch is lost.
    assert.equal(canDeleteComment(comment, 'moderator'), false);
    assert.equal(canDeleteComment(comment, 'stranger'), false);
  });
});

describe('SOC-06 comment bodies', () => {
  it('trims, because trailing whitespace is not content', () => {
    assert.equal(normalizeCommentBody('  strong session  '), 'strong session');
  });

  it('refuses a body that is empty or only whitespace', () => {
    assert.equal(normalizeCommentBody(''), null);
    assert.equal(normalizeCommentBody('   \n\t '), null);
  });

  it('refuses an over-long body rather than truncating it', () => {
    // A comment clipped mid-sentence would misrepresent its author, so the
    // server refuses instead of silently storing something they did not write.
    const atCap = 'x'.repeat(ACTIVITY_COMMENT_MAX_LENGTH);
    assert.equal(normalizeCommentBody(atCap), atCap);
    assert.equal(normalizeCommentBody('x'.repeat(ACTIVITY_COMMENT_MAX_LENGTH + 1)), null);
  });

  it('measures the cap after trimming', () => {
    const padded = `  ${'x'.repeat(ACTIVITY_COMMENT_MAX_LENGTH)}  `;
    assert.equal(normalizeCommentBody(padded)?.length, ACTIVITY_COMMENT_MAX_LENGTH);
  });
});

describe('SOC-06 comment summary', () => {
  it('reports the count it was given', () => {
    // The caller passes only rows this viewer may count -- blocks and hidden
    // comments are filtered before this -- so the number always matches what
    // a read of the list returns.
    assert.equal(summarizeComments(3, { commentsToday: 0 }).count, 3);
  });

  it('withdraws the control once the daily budget is spent', () => {
    assert.equal(summarizeComments(0, { commentsToday: 0 }).canComment, true);
    assert.equal(
      summarizeComments(0, { commentsToday: ACTIVITY_COMMENTS_PER_DAY_MAX - 1 })
        .canComment,
      true,
    );
    assert.equal(
      summarizeComments(0, { commentsToday: ACTIVITY_COMMENTS_PER_DAY_MAX })
        .canComment,
      false,
    );
  });

  it('starts an unfilled entry at none and offers nothing', () => {
    // A half-built entry must never render a control whose budget was never
    // checked.
    assert.deepEqual(emptyCommentSummary(), { count: 0, canComment: false });
  });
});

describe('SOC-06 comment paging', () => {
  it('round-trips the instant and the id', () => {
    // Two comments can share a millisecond, so the instant alone would drop or
    // repeat one at a page boundary.
    const at = new Date('2026-09-21T14:30:00.123Z');
    const decoded = decodeCommentCursor(encodeCommentCursor({ at, id: 'c-9' }));
    assert.equal(decoded?.at.toISOString(), at.toISOString());
    assert.equal(decoded?.id, 'c-9');
  });

  it('treats a malformed cursor as no cursor rather than throwing', () => {
    assert.equal(decodeCommentCursor(undefined), null);
    assert.equal(decodeCommentCursor(''), null);
    assert.equal(decodeCommentCursor('bm90LWEtY3Vyc29y'), null);
  });

  it('clamps the page size to the contract maximum', () => {
    assert.equal(commentPageSize(undefined), ACTIVITY_COMMENTS_PAGE_SIZE);
    assert.equal(commentPageSize(0), ACTIVITY_COMMENTS_PAGE_SIZE);
    assert.equal(commentPageSize(5), 5);
    assert.equal(commentPageSize(9999), ACTIVITY_COMMENTS_PAGE_SIZE);
  });
});

describe('SOC-06 the comment notification', () => {
  const comment = {
    id: 'comment-1',
    entryKey: 'session:s1:completed:v1',
    userId: 'writer',
    createdAt: new Date('2026-09-21T14:00:00.000Z'),
  };

  it('announces a comment once, keyed by its own id', () => {
    const drafts = gatherNotifications({
      events: [],
      follows: [],
      sessions: [],
      comments: [comment],
    });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].kind, 'ACTIVITY_COMMENT');
    assert.equal(drafts[0].sourceKey, 'comment:comment-1');
    assert.equal(drafts[0].actorId, 'writer');
  });

  it('carries the entry but never the body', () => {
    // The row outlives the comment: it can be deleted by its author, by the
    // recipient, or hidden by a moderator, and a quoted copy could not be
    // withdrawn by any of them.
    const [draft] = gatherNotifications({
      events: [],
      follows: [],
      sessions: [],
      comments: [comment],
    });
    assert.deepEqual(draft.payload, { entryId: 'session:s1:completed:v1' });
    assert.equal(JSON.stringify(draft).includes('body'), false);
  });

  it('gathers nothing when there are no comments, as before SOC-06', () => {
    assert.deepEqual(
      gatherNotifications({ events: [], follows: [], sessions: [] }),
      [],
    );
  });
});
