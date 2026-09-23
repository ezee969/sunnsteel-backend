import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_VERSION,
} from '@sunsteel/contracts';
import { DatabaseService } from '../src/database/database.service';
import { AccountExportService } from '../src/users/account-export.service';
import { UsersService } from '../src/users/users.service';
import { WorkoutSessionReadService } from '../src/workouts/workout-session-read.service';
import { WorkoutSessionStartService } from '../src/workouts/services/workout-session-start.service';
import { WorkoutSessionLogService } from '../src/workouts/services/workout-session-log.service';
import { WorkoutSessionFinishService } from '../src/workouts/services/workout-session-finish.service';

const enabled = process.env.ANALYTICS_TEST_DATABASE === 'isolated';

/**
 * EXPORT-01 on real PostgreSQL. A member with a routine, a finished workout,
 * the analytics that follow, social ties and preferences exports their
 * account; the test checks that each section carries what they own and that
 * the file never contains another member's email or any credential.
 */
test(
  'account export on real PostgreSQL: what the member owns, and nothing that is not theirs to take',
  { skip: !enabled },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/td27_test');
    const db = new DatabaseService();
    try {
      // The harness builds a pre-analytics schema and registers only the
      // migrations its own suites read; these two tables the export reads were
      // never registered. Apply them here, after the analytics suite, rather
      // than changing the schema that suite starts from.
      for (const [table, migration] of [
        [
          'TrainingLocationPreference',
          '20260908170000_training_location_preferences',
        ],
        ['MeasurableGoal', '20260913213000_measurable_goals'],
      ]) {
        const [row] = await db.$queryRawUnsafe<Array<{ present: boolean }>>(
          `SELECT to_regclass('public."${table}"') IS NOT NULL AS present`,
        );
        if (!row.present) {
          execFileSync(
            process.execPath,
            [
              'node_modules/prisma/build/index.js',
              'db',
              'execute',
              '--file',
              `prisma/migrations/${migration}/migration.sql`,
              '--url',
              process.env.DATABASE_URL!,
            ],
            { windowsHide: true, stdio: 'pipe' },
          );
        }
      }
      const owner = await db.user.create({
        data: {
          email: 'exporting@isolated.test',
          username: 'export_owner',
          name: 'Exporting member',
          weight: 82.5,
          weightUnit: 'LB',
          timeZone: 'Europe/Oslo',
          quietHoursStartMinute: 1320,
          quietHoursEndMinute: 420,
        },
      });
      const other = await db.user.create({
        data: {
          email: 'private-address@isolated.test',
          username: 'export_other',
          name: 'Other member',
        },
      });
      const exercise = await db.exercise.create({
        data: {
          name: 'Export Row',
          equipment: 'barbell',
          primaryMuscles: ['LATISSIMUS_DORSI'],
          secondaryMuscles: ['BICEPS'],
        },
      });
      const routine = await db.routine.create({
        data: {
          userId: owner.id,
          name: 'Exported programme',
          days: {
            create: {
              dayOfWeek: 2,
              exercises: {
                create: {
                  exerciseId: exercise.id,
                  restSeconds: 120,
                  progressionScheme: 'NONE',
                  sets: { create: { setNumber: 1, reps: 8, weight: 70 } },
                },
              },
            },
          },
        },
        include: { days: { include: { exercises: true } } },
      });
      await db.routineVersion.create({
        data: {
          routineId: routine.id,
          number: 1,
          name: 'Before the change',
          kind: 'SAVED',
          setup: {
            name: 'Exported programme',
            description: null,
            scheduleMode: 'WEEKLY',
            restDays: [],
            rotationWeekdays: [],
            days: [],
          },
        },
      });
      await db.routine.update({
        where: { id: routine.id },
        data: { lastVersionNumber: 1 },
      });

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
          weight: 72.5,
          reps: 8,
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

      // Records and events are the analytics writer's, which only runs for an
      // account with an active projection; seed one of each directly.
      const setLog = await db.setLog.findFirstOrThrow({
        where: { sessionId: session.id },
      });
      await db.personalRecord.create({
        data: {
          userId: owner.id,
          exerciseId: exercise.id,
          exerciseName: 'Export Row',
          sessionId: session.id,
          setLogId: setLog.id,
          weight: 72.5,
          reps: 8,
          estimated1rm: 91.8,
          achievedAt: new Date(),
        },
      });
      await db.trainingEvent.create({
        data: {
          eventKey: `session-completed:${session.id}`,
          userId: owner.id,
          sessionId: session.id,
          type: 'SESSION_COMPLETED',
          occurredAt: new Date(),
          schemaVersion: 1,
          payload: { sessionId: session.id },
        },
      });
      await db.measurableGoal.create({
        data: {
          userId: owner.id,
          type: 'WEEKLY_SESSIONS',
          direction: 'AT_LEAST',
          targetValue: 3,
        },
      });
      await db.starredExercise.create({
        data: { userId: owner.id, exerciseId: exercise.id },
      });
      await db.userFollow.createMany({
        data: [
          { followerId: owner.id, followingId: other.id },
          { followerId: other.id, followingId: owner.id },
        ],
      });
      await db.activityComment.create({
        data: {
          entryKey: 'session:of-other',
          userId: owner.id,
          authorId: other.id,
          body: 'My own words',
        },
      });
      const routineShare = await db.routineShare.create({
        data: {
          token: 'SECRET-ROUTINE-TOKEN-0000000',
          routineId: routine.id,
          userId: owner.id,
        },
      });
      await db.pushSubscription.create({
        data: {
          userId: owner.id,
          endpoint: 'https://push.example.invalid/SECRET-ENDPOINT',
          p256dh: 'SECRET-P256DH',
          auth: 'SECRET-AUTH',
        },
      });

      const exported = await new AccountExportService(
        db,
        new UsersService(db),
      ).exportAccount(owner.id);
      const text = JSON.stringify(exported);

      assert.equal(exported.format, ACCOUNT_EXPORT_FORMAT);
      assert.equal(exported.formatVersion, ACCOUNT_EXPORT_VERSION);
      assert.equal(exported.weightsAreKilograms, true);
      assert.equal(exported.account.username, 'export_owner');
      assert.equal(exported.account.email, 'exporting@isolated.test');
      assert.equal(exported.preferences.timeZone, 'Europe/Oslo');
      assert.deepEqual(exported.preferences.notifications.quietHours, {
        startMinute: 1320,
        endMinute: 420,
      });

      assert.equal(exported.routines.length, 1);
      assert.equal(exported.routines[0].routine.name, 'Exported programme');
      assert.equal(
        exported.routines[0].routine.days[0].exercises[0].exercise.name,
        'Export Row',
      );
      assert.equal(exported.routines[0].versions[0].name, 'Before the change');

      assert.equal(exported.workouts.length, 1);
      assert.equal(exported.workouts[0].status, 'COMPLETED');
      const [loggedSet] = exported.workouts[0].setLogs ?? [];
      // Kilograms as stored, although the account displays pounds.
      assert.equal(loggedSet.weight, 72.5);
      assert.equal(loggedSet.reps, 8);

      assert.equal(exported.personalRecords.length, 1);
      assert.equal(exported.personalRecords[0].weightKg, 72.5);
      assert.ok(
        exported.trainingEvents.some(
          (event) => event.type === 'SESSION_COMPLETED',
        ),
      );
      assert.equal(exported.goals[0].type, 'WEEKLY_SESSIONS');
      assert.equal(exported.exercises.starred[0].name, 'Export Row');
      assert.deepEqual(
        exported.social.following.map((m) => m.username),
        ['export_other'],
      );
      assert.deepEqual(
        exported.social.followers.map((m) => m.username),
        ['export_other'],
      );
      assert.equal(exported.social.commentsWritten[0].body, 'My own words');
      assert.equal(
        exported.social.commentsWritten[0].onActivityOf.username,
        'export_other',
      );

      // What must never be in the file.
      assert.ok(
        !text.includes('private-address@isolated.test'),
        'another member’s email',
      );
      assert.ok(!text.includes(routineShare.token), 'a share-link token');
      assert.ok(!text.includes('SECRET-ENDPOINT'), 'a push endpoint');
      assert.ok(
        !text.includes('SECRET-P256DH') && !text.includes('SECRET-AUTH'),
        'push keys',
      );
      assert.ok(exported.omitted.length > 0);

      await db.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
      await db.exercise.deleteMany({ where: { id: exercise.id } });
    } finally {
      await db.$disconnect();
    }
  },
);
