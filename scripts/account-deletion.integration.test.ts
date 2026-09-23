import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DatabaseService } from '../src/database/database.service';
import type { SupabaseService } from '../src/auth/supabase.service';
import { AccountDeletionService } from '../src/users/account-deletion.service';
import { WorkoutSessionReadService } from '../src/workouts/workout-session-read.service';
import { WorkoutSessionStartService } from '../src/workouts/services/workout-session-start.service';
import { WorkoutSessionLogService } from '../src/workouts/services/workout-session-log.service';
import { WorkoutSessionFinishService } from '../src/workouts/services/workout-session-finish.service';

const enabled = process.env.ANALYTICS_TEST_DATABASE === 'isolated';

/**
 * TRUST-01 on real PostgreSQL, with every migration applied.
 *
 * The first half is structural and is what keeps this true as tables are
 * added: deleting a `User` row must never be blocked, so every foreign key
 * into anything that cascades from `User` has to cascade or set null itself.
 * A new table referencing a member's routine with the default `RESTRICT`
 * would make that member undeletable, and fail here first.
 *
 * The second half deletes a member with real training history through the
 * service and checks what went and what stayed.
 */
test(
  'account deletion on real PostgreSQL: nothing can block it, and it takes exactly what the member owned',
  { skip: !enabled },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/td27_test');
    const db = new DatabaseService();
    // A second connection, to see what everyone else sees mid-transaction.
    const observer = new DatabaseService();
    try {
      // The harness builds the pre-analytics schema and the analytics suite
      // applies the FK cutover mid-run, which is why this file runs after it
      // (package.json). Until then SetLog -> RoutineExercise is still the
      // legacy RESTRICT that production no longer has.
      const [cutover] = await db.$queryRaw<Array<{ rule: string }>>`
        SELECT confdeltype::text AS rule FROM pg_constraint
        WHERE conname = 'SetLog_routineExerciseId_fkey'`;
      assert.equal(
        cutover?.rule,
        'n',
        'Run after scripts/analytics-integration.test.ts, which applies the analytics FK cutover',
      );
      const blockers = await db.$queryRaw<
        Array<{ constraint: string; table: string; references: string }>
      >`
        WITH RECURSIVE owned(tbl) AS (
          SELECT '"User"'::regclass
          UNION
          SELECT c.conrelid FROM pg_constraint c
          JOIN owned ON c.confrelid = owned.tbl
          WHERE c.contype = 'f' AND c.confdeltype = 'c'
        )
        SELECT c.conname AS "constraint",
               c.conrelid::regclass::text AS "table",
               c.confrelid::regclass::text AS "references"
        FROM pg_constraint c
        WHERE c.contype = 'f'
          AND c.confrelid IN (SELECT tbl FROM owned)
          AND c.confdeltype NOT IN ('c', 'n', 'd')
        ORDER BY 1`;
      assert.deepEqual(
        blockers,
        [],
        'every foreign key into a table that cascades from "User" must cascade or set null',
      );

      const owner = await db.user.create({
        data: {
          email: 'deleted@isolated.test',
          username: 'deletion_owner',
          name: 'Leaving member',
          supabaseUserId: '44444444-4444-4444-8444-444444444444',
        },
      });
      const other = await db.user.create({
        data: {
          email: 'staying@isolated.test',
          username: 'deletion_other',
          name: 'Staying member',
        },
      });
      const exercise = await db.exercise.create({
        data: {
          name: 'Deletion Press',
          equipment: 'barbell',
          primaryMuscles: ['PECTORAL'],
          secondaryMuscles: ['TRICEPS'],
        },
      });
      const routine = await db.routine.create({
        data: {
          userId: owner.id,
          name: 'Leaving programme',
          days: {
            create: {
              dayOfWeek: 1,
              exercises: {
                create: {
                  exerciseId: exercise.id,
                  restSeconds: 90,
                  progressionScheme: 'NONE',
                  sets: { create: { setNumber: 1, reps: 5, weight: 60 } },
                },
              },
            },
          },
        },
        include: { days: { include: { exercises: true } } },
      });

      // Real history through the services: a session, a logged set, the
      // analytics writer's events and records.
      const reads = new WorkoutSessionReadService(db);
      const session = await new WorkoutSessionStartService(
        db,
        reads,
      ).startSession(owner.id, {
        routineId: routine.id,
        routineDayId: routine.days[0].id,
      });
      await new WorkoutSessionLogService(db).upsertSetLog(
        owner.id,
        session.id,
        {
          routineExerciseId: routine.days[0].exercises[0].id,
          exerciseId: exercise.id,
          setNumber: 1,
          weight: 62.5,
          reps: 5,
          isCompleted: true,
        },
      );
      await new WorkoutSessionFinishService(db).finishSession(
        owner.id,
        session.id,
        {
          status: 'COMPLETED',
        },
      );

      // What the other member made from, or about, the leaving member.
      const clone = await db.routine.create({
        data: {
          userId: other.id,
          name: 'Copied programme',
          clonedFromRoutineId: routine.id,
          clonedFromUserId: owner.id,
          clonedAt: new Date(),
        },
      });
      await db.userFollow.createMany({
        data: [
          { followerId: owner.id, followingId: other.id },
          { followerId: other.id, followingId: owner.id },
        ],
      });
      await db.activityComment.create({
        data: {
          entryKey: 'session:elsewhere',
          userId: owner.id,
          authorId: other.id,
          body: 'Strong work',
        },
      });
      await db.notification.create({
        data: {
          userId: other.id,
          actorId: owner.id,
          kind: 'NEW_FOLLOWER',
          sourceKey: `follow:${owner.id}`,
          payload: {},
          createdAt: new Date(),
        },
      });
      await db.memberReport.create({
        data: {
          reporterId: owner.id,
          subjectKind: 'MEMBER',
          subjectId: other.id,
          reason: 'SPAM',
        },
      });
      const reportAboutOwner = await db.memberReport.create({
        data: {
          reporterId: other.id,
          subjectKind: 'MEMBER',
          subjectId: owner.id,
          reason: 'OTHER',
        },
      });

      const supabaseCalls: string[] = [];
      const supabase = {
        async removeStoredAvatars(prefixes: string[]) {
          supabaseCalls.push(`avatars ${prefixes.length}`);
          return 0;
        },
        async deleteAuthUser(id: string) {
          // Inside the transaction: the local row is already gone for this
          // transaction but not yet for anyone else.
          const outside = await observer.user.count({
            where: { id: owner.id },
          });
          supabaseCalls.push(`auth ${id} visible-outside=${outside}`);
        },
      } as unknown as SupabaseService;

      await new AccountDeletionService(db, supabase).deleteAccount(
        owner.id,
        'deletion_owner',
      );

      assert.deepEqual(supabaseCalls, [
        'avatars 2',
        `auth ${owner.supabaseUserId} visible-outside=1`,
      ]);

      assert.equal(await db.user.count({ where: { id: owner.id } }), 0);
      assert.equal(await db.routine.count({ where: { userId: owner.id } }), 0);
      assert.equal(
        await db.workoutSession.count({ where: { userId: owner.id } }),
        0,
      );
      assert.equal(
        await db.setLog.count({ where: { sessionId: session.id } }),
        0,
      );
      assert.equal(
        await db.trainingEvent.count({ where: { userId: owner.id } }),
        0,
      );
      assert.equal(
        await db.personalRecord.count({ where: { userId: owner.id } }),
        0,
      );
      assert.equal(
        await db.userFollow.count({
          where: { OR: [{ followerId: owner.id }, { followingId: owner.id }] },
        }),
        0,
      );
      assert.equal(
        await db.activityComment.count({ where: { userId: owner.id } }),
        0,
      );
      assert.equal(
        await db.notification.count({ where: { actorId: owner.id } }),
        0,
      );
      assert.equal(
        await db.memberReport.count({ where: { reporterId: owner.id } }),
        0,
      );

      // What was never the leaving member's to take.
      const keptClone = await db.routine.findUniqueOrThrow({
        where: { id: clone.id },
      });
      assert.equal(keptClone.userId, other.id);
      assert.equal(keptClone.clonedFromRoutineId, null);
      assert.equal(keptClone.clonedFromUserId, null);
      assert.equal(await db.user.count({ where: { id: other.id } }), 1);
      assert.equal(await db.exercise.count({ where: { id: exercise.id } }), 1);
      // A report about the member stays for the queue, which already shows a
      // subject that no longer resolves as missing.
      assert.equal(
        await db.memberReport.count({ where: { id: reportAboutOwner.id } }),
        1,
      );

      await db.memberReport.deleteMany({ where: { id: reportAboutOwner.id } });
      await db.routine.deleteMany({ where: { id: clone.id } });
      await db.user.deleteMany({ where: { id: other.id } });
      await db.exercise.deleteMany({ where: { id: exercise.id } });
    } finally {
      await Promise.all([db.$disconnect(), observer.$disconnect()]);
    }
  },
);
