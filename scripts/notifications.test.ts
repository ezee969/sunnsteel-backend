import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseService } from '../src/database/database.service';
import {
  gatherNotifications,
  lookbackStart,
  retentionStart,
} from '../src/notifications/notification-sources';
import { NotificationsService } from '../src/notifications/notifications.service';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const at = (iso: string) => new Date(iso);

const achievement = (id: string, backfilled: boolean, when: string) => ({
  type: 'ACHIEVEMENT_UNLOCKED',
  sessionId: 's1',
  occurredAt: at(when),
  payload: {
    schemaVersion: 1,
    id,
    category: 'SESSIONS',
    threshold: 10,
    title: '10 Sessions',
    description: 'Complete 10 sessions.',
    backfilled,
  },
});

const sessionEvent = (type: string, sessionId: string) => ({
  type,
  sessionId,
  occurredAt: at('2026-09-14T18:30:00.000Z'),
  payload: { schemaVersion: 1 },
});

const finished = {
  id: 's1',
  status: 'COMPLETED',
  endedAt: at('2026-09-14T19:00:00.000Z'),
  routineName: 'Upper / Lower',
  dayName: 'Upper',
};

test('only achievements earned live are announced', () => {
  const drafts = gatherNotifications({
    events: [
      achievement('sessions-10', false, '2026-09-14T19:00:00.000Z'),
      achievement('sessions-1', true, '2026-09-10T12:00:00.000Z'),
    ],
    follows: [],
    sessions: [],
  });
  assert.equal(drafts.length, 1);
  assert.deepEqual(
    [drafts[0].kind, drafts[0].sourceKey, drafts[0].sessionId],
    ['ACHIEVEMENT', 'achievement:sessions-10', null],
  );
  assert.deepEqual(drafts[0].payload, {
    achievementId: 'sessions-10',
    title: '10 Sessions',
    description: 'Complete 10 sessions.',
  });
});

test('a finished session with records or load changes is one note', () => {
  const drafts = gatherNotifications({
    events: [
      sessionEvent('PERSONAL_RECORD', 's1'),
      sessionEvent('PERSONAL_RECORD', 's1'),
      sessionEvent('PROGRESSION_CHANGED', 's1'),
      // Still in progress: it waits until the session ends.
      sessionEvent('PERSONAL_RECORD', 's2'),
      // A session that is gone announces nothing.
      sessionEvent('PERSONAL_RECORD', 's3'),
    ],
    follows: [],
    sessions: [
      finished,
      { ...finished, id: 's2', status: 'IN_PROGRESS', endedAt: null },
    ],
  });
  assert.deepEqual(
    drafts.map((draft) => [draft.kind, draft.sourceKey, draft.sessionId]),
    [['SESSION_PROGRESS', 'session:s1', 's1']],
  );
  assert.deepEqual(drafts[0].payload, {
    routineName: 'Upper / Lower',
    dayName: 'Upper',
    recordCount: 2,
    progressionCount: 1,
  });
  assert.equal(drafts[0].createdAt.toISOString(), '2026-09-14T19:00:00.000Z');
});

test('every follow is its own note, keyed by its time', () => {
  const drafts = gatherNotifications({
    events: [],
    follows: [
      { followerId: 'u2', createdAt: at('2026-09-01T10:00:00.000Z') },
      { followerId: 'u2', createdAt: at('2026-09-12T10:00:00.000Z') },
    ],
    sessions: [],
  });
  assert.deepEqual(
    drafts.map((draft) => [draft.kind, draft.actorId]),
    [
      ['NEW_FOLLOWER', 'u2'],
      ['NEW_FOLLOWER', 'u2'],
    ],
  );
  assert.notEqual(drafts[0].sourceKey, drafts[1].sourceKey);
  assert.equal(lookbackStart(NOW).toISOString(), '2026-08-16T12:00:00.000Z');
  assert.equal(retentionStart(NOW).toISOString(), '2026-06-17T12:00:00.000Z');
});

type Row = {
  id: string;
  userId: string;
  kind: string;
  sourceKey: string;
  actorId: string | null;
  sessionId: string | null;
  payload: any;
  createdAt: Date;
  readAt: Date | null;
};

function fakeDb(rows: Row[], follows: any[] = []) {
  const reads: Record<string, any[]> = { events: [], sessions: [] };
  const users: Record<string, any> = {
    u2: {
      id: 'u2',
      username: 'marta',
      name: 'Marta',
      lastName: null,
      avatarUrl: null,
    },
  };
  const matches = (row: Row, where: any) =>
    row.userId === where.userId &&
    (!('readAt' in where) || row.readAt === where.readAt) &&
    (!where.id || where.id.in.includes(row.id)) &&
    (!where.createdAt || row.createdAt < where.createdAt.lt);
  const db = {
    trainingEvent: {
      findMany: async (query: any) => {
        reads.events.push(query);
        return [
          achievement('sessions-10', false, '2026-09-14T19:00:00.000Z'),
          sessionEvent('PERSONAL_RECORD', 's1'),
        ];
      },
    },
    workoutSession: {
      findMany: async (query: any) => {
        reads.sessions.push(query);
        return [
          {
            id: 's1',
            status: 'COMPLETED',
            endedAt: at('2026-09-14T19:00:00.000Z'),
            snapshot: null,
            routine: { name: 'Upper / Lower' },
            routineDay: { dayOfWeek: 1, name: 'Upper', order: 0 },
          },
        ];
      },
    },
    userFollow: {
      // Followers of u1; u1 follows nobody back.
      findMany: async (query: any) =>
        query.where.followingId === 'u1' ? follows : [],
    },
    notification: {
      createMany: async (query: any) => {
        let count = 0;
        for (const data of query.data) {
          if (
            rows.some(
              (row) =>
                row.userId === data.userId && row.sourceKey === data.sourceKey,
            )
          ) {
            continue;
          }
          rows.push({ id: `n${rows.length + 1}`, readAt: null, ...data });
          count += 1;
        }
        return { count };
      },
      deleteMany: async (query: any) => {
        const kept = rows.filter((row) => !matches(row, query.where));
        rows.splice(0, rows.length, ...kept);
        return { count: 0 };
      },
      findMany: async (query: any) =>
        rows
          .filter((row) => row.userId === query.where.userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, query.take)
          .map((row) => ({
            ...row,
            actor: row.actorId ? users[row.actorId] : null,
          })),
      count: async (query: any) =>
        rows.filter((row) => matches(row, query.where)).length,
      updateMany: async (query: any) => {
        const hit = rows.filter((row) => matches(row, query.where));
        for (const row of hit) row.readAt = query.data.readAt;
        return { count: hit.length };
      },
    },
  } as unknown as DatabaseService;
  return { service: new NotificationsService(db), reads };
}

test('reading gathers once, keeps read state and drops old notifications', async () => {
  const rows: Row[] = [
    {
      id: 'old',
      userId: 'u1',
      kind: 'ACHIEVEMENT',
      sourceKey: 'achievement:ancient',
      actorId: null,
      sessionId: null,
      payload: {},
      createdAt: at('2026-05-01T00:00:00.000Z'),
      readAt: null,
    },
  ];
  const { service, reads } = fakeDb(rows, [
    { followerId: 'u2', createdAt: at('2026-09-13T08:00:00.000Z') },
  ]);
  const first = await service.list('u1', NOW);
  assert.deepEqual(
    first.notifications.map((n) => n.kind),
    ['ACHIEVEMENT', 'SESSION_PROGRESS', 'NEW_FOLLOWER'],
  );
  assert.equal(first.unreadCount, 3);
  assert.equal(reads.events[0].where.occurredAt.gte.toISOString(), '2026-08-16T12:00:00.000Z');
  const progress = first.notifications[1];
  assert.ok(progress.kind === 'SESSION_PROGRESS');
  assert.deepEqual(progress.session, {
    id: 's1',
    routineName: 'Upper / Lower',
    dayName: 'Upper',
    recordCount: 1,
    progressionCount: 0,
  });
  const follower = first.notifications[2];
  assert.ok(follower.kind === 'NEW_FOLLOWER');
  assert.equal(follower.actor.username, 'marta');
  assert.equal(follower.actor.isFollowedByMe, false);

  const marked = await service.markRead('u1', [first.notifications[0].id], NOW);
  assert.equal(marked.unreadCount, 2);
  // Gathering again neither duplicates nor resets what was read.
  const second = await service.list('u1', NOW);
  assert.equal(second.notifications.length, 3);
  assert.equal(second.unreadCount, 2);
  assert.equal(second.notifications[0].readAt, NOW.toISOString());

  assert.deepEqual(await service.markRead('u1', undefined, NOW), {
    unreadCount: 0,
  });
});
