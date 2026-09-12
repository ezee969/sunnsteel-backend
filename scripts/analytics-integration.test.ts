import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseService } from '../src/database/database.service';
import { AnalyticsService } from '../src/workouts/analytics/analytics.service';
import { WorkoutSessionStartService } from '../src/workouts/services/workout-session-start.service';
import { WorkoutSessionFinishService } from '../src/workouts/services/workout-session-finish.service';
import { WorkoutSessionLogService } from '../src/workouts/services/workout-session-log.service';
import { WorkoutSessionReadService } from '../src/workouts/workout-session-read.service';
import { WorkoutProgressService } from '../src/workouts/workout-progress.service';
import { WorkoutVolumeTrendService } from '../src/workouts/workout-volume-trend.service';
import { LegacyWorkoutProgressService } from './fixtures/legacy-workout-progress';
import { RoutinesService } from '../src/routines/routines.service';
import { toWorkoutSessionResponse } from '../src/workouts/workout-session.mapper';

const enabled = process.env.ANALYTICS_TEST_DATABASE === 'isolated';

test(
  'analytics on real PostgreSQL: atomic finishes, historical parity, resumable backfill, cutover and bounded reads',
  { skip: !enabled },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(
      url.hostname,
      '127.0.0.1',
      'Integration suite only accepts an isolated loopback database',
    );
    assert.equal(url.pathname, '/td27_test');
    const captured: Array<{ query: string; params: string }> = [];
    const db = new DatabaseService({
      log: [{ emit: 'event', level: 'query' }],
    });
    (db as any).$on('query', (event: { query: string; params: string }) =>
      captured.push(event),
    );
    const analytics = new AnalyticsService(db);
    const reads = new WorkoutSessionReadService(db);
    const starts = new WorkoutSessionStartService(db, reads);
    const finishes = new WorkoutSessionFinishService(db);
    const logs = new WorkoutSessionLogService(db);
    const routines = new RoutinesService(db);
    const progress = new WorkoutProgressService(db);
    const volumeTrends = new WorkoutVolumeTrendService(db);
    const legacy = new LegacyWorkoutProgressService(db);
    const drain = async () => {
      for (let i = 0; i < 100; i++) {
        if (!(await analytics.runBatch(2))) return;
      }
      throw new Error('Backfill did not drain');
    };
    try {
      const user = await db.user.create({
        data: {
          email: 'analytics@isolated.test',
          username: 'analytics_fixture',
          name: 'Analytics fixture',
        },
      });
      const exercise = await db.exercise.create({
        data: {
          name: 'Analytics Squat',
          equipment: 'barbell',
          primaryMuscles: ['QUADRICEPS'],
          secondaryMuscles: ['GLUTES'],
        },
      });
      const routine = await db.routine.create({
        data: {
          userId: user.id,
          name: 'Original prescription',
          days: {
            create: {
              dayOfWeek: 1,
              exercises: {
                create: {
                  exerciseId: exercise.id,
                  note: 'Original note',
                  restSeconds: 90,
                  progressionScheme: 'DOUBLE_PROGRESSION',
                  minWeightIncrement: 2.5,
                  sets: {
                    create: { setNumber: 1, reps: 5, weight: 100, rir: 2 },
                  },
                },
              },
            },
          },
        },
        include: { days: { include: { exercises: true } } },
      });
      const day = routine.days[0];
      const rx = day.exercises[0];
      // Available historical prescriptions can only be approximated, never called captured.
      for (const [index, weight, reps, completed] of [
        [0, 90.125, 5, true],
        [1, 100, 5, true],
        [2, 100, 5, true],
        [3, null, null, true],
        [4, 0, 0, false],
      ] as const) {
        const endedAt = new Date(
          `2026-08-${String(20 + index * 2).padStart(2, '0')}T22:30:00Z`,
        );
        await db.workoutSession.create({
          data: {
            userId: user.id,
            routineId: routine.id,
            routineDayId: day.id,
            status: 'COMPLETED',
            startedAt: new Date(endedAt.getTime() - 10000),
            endedAt,
            setLogs: {
              create: {
                routineExerciseId: rx.id,
                exerciseId: exercise.id,
                setNumber: 1,
                weight,
                reps,
                isCompleted: completed,
                completedAt: endedAt,
              },
            },
          },
        });
      }
      await db.workoutSession.create({
        data: {
          userId: user.id,
          routineId: routine.id,
          routineDayId: day.id,
          status: 'ABORTED',
          endedAt: new Date(),
        },
      });
      const before = await legacy.getProgress(user.id, {
        timeZone: 'Europe/Berlin',
      });
      const status = await analytics.setTimeZone(user.id, {
        timeZone: 'Europe/Berlin',
        onlyIfUnset: true,
      });
      assert.equal(status.state, 'BUILDING');
      assert.equal(status.timeZone, null);
      assert.deepEqual(
        await analytics.setTimeZone(user.id, {
          timeZone: 'America/New_York',
          onlyIfUnset: true,
        }),
        status,
      );
      await assert.rejects(
        progress.getProjectedProgress(user.id, { timeZone: 'Europe/Berlin' }),
        /not ready/,
      );
      await assert.rejects(
        routines.update(user.id, routine.id, { name: 'Too early' }),
        /snapshots/,
      );
      await analytics.runBatch(2); // Interrupt and resume from a persisted snapshot cursor.
      while (
        !(
          await db.analyticsBackfillJob.findUniqueOrThrow({
            where: { projectionId: status.generationId! },
          })
        ).snapshotsComplete
      )
        await analytics.runBatch(2);
      await db.$executeRawUnsafe(
        `CREATE FUNCTION reject_analytics_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected analytics failure'; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER reject_rollup BEFORE INSERT ON "WorkoutRollup" FOR EACH ROW EXECUTE FUNCTION reject_analytics_write()`,
      );
      assert.equal(
        ((await analytics.runBatch(2)) as { failed?: boolean })?.failed,
        true,
      );
      const interrupted = await db.analyticsBackfillJob.findUniqueOrThrow({
        where: { projectionId: status.generationId! },
      });
      assert.equal(interrupted.attempts, 1);
      assert.equal(interrupted.cursorEndedAt, null);
      assert.equal(
        await db.trainingEvent.count({ where: { userId: user.id } }),
        0,
      );
      assert.equal(await db.workoutRollup.count(), 0);
      await analytics.runBatch(2);
      await analytics.runBatch(2);
      assert.equal((await analytics.status(user.id)).state, 'FAILED');
      assert.equal(
        (
          await db.analyticsBackfillJob.findUniqueOrThrow({
            where: { projectionId: status.generationId! },
          })
        ).attempts,
        3,
      );
      await db.$executeRawUnsafe(
        'DROP TRIGGER reject_rollup ON "WorkoutRollup"',
      );
      const retried = await analytics.setTimeZone(user.id, {
        timeZone: 'America/New_York',
        onlyIfUnset: true,
      });
      assert.equal(retried.requestedTimeZone, 'Europe/Berlin');
      assert.notEqual(retried.generationId, status.generationId);

      await drain();
      assert.equal((await analytics.status(user.id)).state, 'READY');
      assert.deepEqual(
        await progress.getProjectedProgress(user.id, {
          timeZone: 'Europe/Berlin',
        }),
        before,
      );
      const volumeTrend = await volumeTrends.getVolumeTrend(user.id, {
        timeZone: 'Europe/Berlin',
        weeks: 4,
      });
      assert.equal(volumeTrend.overall.length, 4);
      assert.ok(volumeTrend.overall.some(point => point.volumeKg > 0));
      assert.equal(volumeTrend.routines[0]?.name, 'Original prescription');
      assert.ok(volumeTrend.routines[0]?.totalVolumeKg > 0);
      assert.equal(volumeTrend.exercises[0]?.name, 'Analytics Squat');
      assert.ok(volumeTrend.exercises[0]?.totalVolumeKg > 0);
      assert.ok(
        volumeTrend.muscles.some(
          muscle => muscle.id === 'QUADRICEPS' && muscle.totalVolumeKg > 0,
        ),
      );
      const first = await db.workoutAnalyticsProjection.findFirstOrThrow({
        where: { userId: user.id, active: true },
      });
      const events = await db.trainingEvent.count({
        where: { userId: user.id },
      });
      await analytics.rebuild(user.id, 'Europe/Berlin');
      await Promise.all([analytics.runBatch(2), analytics.runBatch(2)]);
      await drain();
      const rebuilt = await db.workoutAnalyticsProjection.findFirstOrThrow({
        where: { userId: user.id, active: true },
      });
      assert.equal(first.checksum, rebuilt.checksum);
      assert.equal(
        events,
        await db.trainingEvent.count({ where: { userId: user.id } }),
      );
      assert.deepEqual(
        await progress.getProjectedProgress(user.id, {
          timeZone: 'Europe/Berlin',
        }),
        before,
      );

      const started = await starts.startSession(user.id, {
        routineId: routine.id,
        routineDayId: day.id,
      });
      await assert.rejects(
        routines.update(user.id, routine.id, { days: [] }),
        /active session/,
      );
      await logs.upsertSetLog(user.id, started.id, {
        routineExerciseId: rx.id,
        exerciseId: exercise.id,
        setNumber: 1,
        weight: 110.125,
        reps: 5,
        isCompleted: true,
      });
      await db.$executeRawUnsafe(
        `CREATE TRIGGER reject_event BEFORE INSERT ON "TrainingEvent" FOR EACH ROW EXECUTE FUNCTION reject_analytics_write()`,
      );
      await assert.rejects(
        finishes.finishSession(user.id, started.id, { status: 'COMPLETED' }),
        /Injected analytics failure/,
      );
      assert.equal(
        (
          await db.workoutSession.findUniqueOrThrow({
            where: { id: started.id },
          })
        ).status,
        'IN_PROGRESS',
      );
      assert.equal(
        (
          await db.routineExerciseSet.findFirstOrThrow({
            where: { routineExerciseId: rx.id },
          })
        ).weight,
        100,
      );
      await db.$executeRawUnsafe(
        'DROP TRIGGER reject_event ON "TrainingEvent"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION reject_analytics_write()');
      const finished = await Promise.all([
        finishes.finishSession(user.id, started.id, { status: 'COMPLETED' }),
        finishes.finishSession(user.id, started.id, { status: 'COMPLETED' }),
      ]);
      assert.equal(
        finished[0].session.endedAt!.getTime(),
        finished[1].session.endedAt!.getTime(),
      );
      assert.equal(
        await db.trainingEvent.count({
          where: { sessionId: started.id, type: 'SESSION_COMPLETED' },
        }),
        1,
      );
      assert.equal(
        (
          await db.routineExerciseSet.findFirstOrThrow({
            where: { routineExerciseId: rx.id },
          })
        ).weight,
        112.625,
      );
      assert.equal(
        toWorkoutSessionResponse(
          await reads.getSessionById(user.id, started.id),
        ).routineDay!.exercises[0].sets[0].weight,
        100,
      );
      await assert.rejects(
        logs.upsertSetLog(user.id, started.id, {
          routineExerciseId: rx.id,
          exerciseId: exercise.id,
          setNumber: 1,
          weight: 999,
          reps: 1,
        }),
        /finished session/,
      );
      const stable = await progress.getProjectedProgress(user.id, {
        timeZone: 'Europe/Berlin',
      });
      assert.deepEqual(
        stable,
        await legacy.getProgress(user.id, { timeZone: 'Europe/Berlin' }),
      );
      const aborted = await starts.startSession(user.id, {
        routineId: routine.id,
        routineDayId: day.id,
      });
      await finishes.finishSession(user.id, aborted.id, { status: 'ABORTED' });
      assert.equal(
        await db.trainingEvent.count({ where: { sessionId: aborted.id } }),
        0,
      );
      assert.deepEqual(
        await progress.getProjectedProgress(user.id, {
          timeZone: 'Europe/Berlin',
        }),
        stable,
      );

      // A finish arriving after the backfill cursor is consumed exactly once by the tail.
      await analytics.setTimeZone(user.id, { timeZone: 'America/New_York' });
      await analytics.runBatch(2);
      const tail = await starts.startSession(user.id, {
        routineId: routine.id,
        routineDayId: day.id,
      });
      await finishes.finishSession(user.id, tail.id, { status: 'COMPLETED' });
      assert.equal((await analytics.status(user.id)).timeZone, 'Europe/Berlin');
      await drain();
      assert.equal(
        (await analytics.status(user.id)).timeZone,
        'America/New_York',
      );
      assert.deepEqual(
        await progress.getProjectedProgress(user.id, {
          timeZone: 'America/New_York',
        }),
        await legacy.getProgress(user.id, { timeZone: 'America/New_York' }),
      );

      // DDL is executed by the isolated harness after initial backfill gates pass.
      execFileSync(
        process.execPath,
        [
          'node_modules/prisma/build/index.js',
          'db',
          'execute',
          '--file',
          'prisma/migrations/20260907090000_analytics_fk_cutover/migration.sql',
          '--url',
          process.env.DATABASE_URL!,
        ],
        { windowsHide: true, stdio: 'pipe' },
      );
      const historical = toWorkoutSessionResponse(
        await reads.getSessionById(user.id, started.id),
      );
      await routines.update(user.id, routine.id, {
        name: 'Edited routine',
        days: [],
      });
      await routines.remove(user.id, routine.id);
      assert.deepEqual(
        toWorkoutSessionResponse(
          await reads.getSessionById(user.id, started.id),
        ),
        historical,
      );
      assert.equal(
        await db.setLog.count({ where: { sessionId: started.id } }),
        1,
      );
      assert.equal(
        (await reads.listSessions(user.id, { routineId: routine.id })).items
          .length,
        9,
      );
      await progress.getProjectedProgress(user.id, {
        timeZone: 'America/New_York',
      });

      // Large synthetic history uses summaries only. EXPLAIN checks actual indexed
      // queries against 20k sessions and 2k PR rows, with no SetLog dependency.
      await db.$executeRaw`INSERT INTO "WorkoutSession" ("id", "userId", "sourceRoutineId", "sourceRoutineDayId", "status", "startedAt", "endedAt", "completedSets", "totalVolumeKg", "updatedAt")
      SELECT 'large-' || i, ${user.id}, 'archived', 'archived-day', 'COMPLETED', timestamp '2020-01-01' + i * interval '1 minute', timestamp '2020-01-01' + i * interval '1 minute', 1, 100, now() FROM generate_series(1,20000) i`;
      await db.$executeRaw`INSERT INTO "PersonalRecord" ("id", "userId", "exerciseId", "exerciseName", "sessionId", "setLogId", "weight", "reps", "estimated1rm", "achievedAt")
      SELECT 'record-' || i, ${user.id}, 'exercise-' || i, 'Fixture', 'fixture', 'fixture', 100, 5, 116.7, timestamp '2020-01-01' + i * interval '1 minute' FROM generate_series(1,2000) i`;
      await db.$executeRawUnsafe('ANALYZE "WorkoutSession"');
      await db.$executeRawUnsafe('ANALYZE "PersonalRecord"');
      await db.$executeRaw`INSERT INTO "User" ("id", "email", "username", "name", "updatedAt") SELECT 'plan-user-' || i, 'plan-' || i || '@isolated.test', 'plan_' || i, 'Plan', now() FROM generate_series(1,2000) i`;
      await db.$executeRaw`INSERT INTO "WorkoutAnalyticsProjection" ("id", "userId", "timeZone", "state", "active") SELECT 'plan-projection-' || i, 'plan-user-' || i, 'UTC', 'READY', true FROM generate_series(1,2000) i`;
      await db.$executeRawUnsafe('ANALYZE "WorkoutAnalyticsProjection"');
      captured.length = 0;
      await progress.getProjectedProgress(user.id, {
        timeZone: 'America/New_York',
      });
      const queries = captured.filter((event) =>
        event.query.trimStart().startsWith('SELECT'),
      );
      assert.equal(queries.length, 3); // snapshots join the five summarized sessions
      assert.doesNotMatch(
        JSON.stringify(queries),
        /SetLog|TrainingEvent|WorkoutRollup/,
      );
      const plans: unknown[] = [];
      for (const query of queries) {
        const plan = await db.$queryRawUnsafe(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`,
          ...JSON.parse(query.params),
        );
        plans.push({ query, plan });
      }
      assert.match(JSON.stringify(plans[0]), /analytics_one_active_user/);
      assert.match(JSON.stringify(plans[1]), /Index Scan/);
      assert.match(JSON.stringify(plans[2]), /workout_recent_completed_sets/);
      assert.doesNotMatch(JSON.stringify(plans), /Seq Scan/);
      if (process.env.ANALYTICS_EXPLAIN_OUTPUT)
        writeFileSync(
          process.env.ANALYTICS_EXPLAIN_OUTPUT,
          JSON.stringify(plans, null, 2),
        );
    } finally {
      await db.$disconnect();
    }
  },
);
