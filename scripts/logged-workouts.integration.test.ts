import "reflect-metadata";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { ConflictException, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { startLinearPeriodization } from "@sunsteel/contracts";
import { DatabaseService } from "../src/database/database.service";
import { AnalyticsService } from "../src/workouts/analytics/analytics.service";
import { WorkoutSessionCorrectionService } from "../src/workouts/services/workout-session-correction.service";
import { WorkoutSessionFinishService } from "../src/workouts/services/workout-session-finish.service";
import { WorkoutSessionLogService } from "../src/workouts/services/workout-session-log.service";
import { WorkoutSessionLoggedService } from "../src/workouts/services/workout-session-logged.service";
import { WorkoutSessionStartService } from "../src/workouts/services/workout-session-start.service";
import { WorkoutSessionReadService } from "../src/workouts/workout-session-read.service";
import {
  loggedLaterSessionIds,
  notFromSessions,
} from "../src/workouts/logged-sessions";

const enabled = process.env.ANALYTICS_TEST_DATABASE === "isolated";

const codeOf = (error: unknown) =>
  (error as ConflictException).getResponse?.() &&
  ((error as ConflictException).getResponse() as { code?: string }).code;

/**
 * LIVE-23 on real PostgreSQL. Two workouts are trained in the app, then a
 * heavier one done before the routine existed is logged. Its history is
 * replayed in a new generation: totals include it, the live records it beats
 * are retired, nothing of it is announced, and the routine -- its loads and
 * its 8-week block -- never moves. Removing it replays again and brings the
 * live records back under their own keys.
 */
test(
  "workouts logged later on real PostgreSQL: counted, replayed, never announced, never moving the routine",
  { skip: !enabled },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/td27_test");
    const db = new DatabaseService();
    const email = "logging@isolated.test";
    const cleanUp = async () => {
      await db.user.deleteMany({ where: { email } });
      await db.exercise.deleteMany({
        where: { name: { in: ["Logged Bench", "Logged Squat"] } },
      });
    };
    await cleanUp();
    try {
      const owner = await db.user.create({
        data: {
          email,
          username: "logged_owner",
          name: "Owner",
          timeZone: "UTC",
        },
      });
      const bench = await db.exercise.create({
        data: {
          name: "Logged Bench",
          equipment: "barbell",
          primaryMuscles: ["PECTORAL"],
          secondaryMuscles: [],
        },
      });
      const squat = await db.exercise.create({
        data: {
          name: "Logged Squat",
          equipment: "barbell",
          primaryMuscles: ["QUADRICEPS"],
          secondaryMuscles: [],
        },
      });
      const block = { ...startLinearPeriodization(100), step: 3 };
      const routine = await db.routine.create({
        data: {
          userId: owner.id,
          name: "Logged programme",
          scheduleMode: "ROTATION",
          days: {
            create: {
              dayOfWeek: null,
              exercises: {
                create: [
                  {
                    exerciseId: bench.id,
                    order: 0,
                    progressionScheme: "DOUBLE_PROGRESSION",
                    minWeightIncrement: 2.5,
                    sets: {
                      create: [
                        { setNumber: 1, reps: 5, weight: 100 },
                        { setNumber: 2, reps: 5, weight: 100 },
                      ],
                    },
                  },
                  {
                    exerciseId: squat.id,
                    order: 1,
                    progressionScheme: "LINEAR_PERIODIZATION",
                    minWeightIncrement: 2.5,
                    linearPeriodization: block as unknown as Prisma.InputJsonValue,
                    sets: {
                      create: [1, 2, 3].map((setNumber) => ({
                        setNumber,
                        repType: "FIXED" as const,
                        reps: null,
                        weight: 70,
                        rir: 2,
                      })),
                    },
                  },
                ],
              },
            },
          },
        },
        include: {
          days: { include: { exercises: { orderBy: { order: "asc" } } } },
        },
      });
      const day = routine.days[0];
      const [benchSlot, squatSlot] = day.exercises;
      await db.workoutAnalyticsProjection.create({
        data: { userId: owner.id, timeZone: "UTC", state: "READY", active: true },
      });

      const reads = new WorkoutSessionReadService(db);
      const starts = new WorkoutSessionStartService(db, reads);
      const sets = new WorkoutSessionLogService(db);
      const finishes = new WorkoutSessionFinishService(db);
      const corrections = new WorkoutSessionCorrectionService(db);
      const logged = new WorkoutSessionLoggedService(db);
      const analytics = new AnalyticsService(db);

      // The bench sets only, so the 8-week block does not advance live.
      const train = async (weight: number) => {
        const session = await starts.startSession(owner.id, {
          routineId: routine.id,
          routineDayId: day.id,
        });
        for (const setNumber of [1, 2])
          await sets.upsertSetLog(owner.id, session.id, {
            routineExerciseId: benchSlot.id,
            exerciseId: bench.id,
            setNumber,
            weight,
            reps: 5,
            isCompleted: true,
          });
        await finishes.finishSession(owner.id, session.id, {
          status: "COMPLETED",
        });
        return session.id;
      };
      const routineState = async () =>
        JSON.stringify(
          await db.routineExercise.findMany({
            where: { routineDayId: day.id },
            orderBy: { order: "asc" },
            select: {
              linearPeriodization: true,
              sets: {
                orderBy: { setNumber: "asc" },
                select: { weight: true, reps: true },
              },
            },
          }),
        );
      const replay = async () => {
        for (let batch = 0; batch < 50; batch += 1) {
          const job = await db.analyticsBackfillJob.findFirst({
            where: { projection: { userId: owner.id, state: "BUILDING" } },
          });
          if (!job) return;
          await analytics.runBatch(10);
        }
        assert.fail("the replay did not finish");
      };
      const active = () =>
        db.workoutAnalyticsProjection.findFirstOrThrow({
          where: { userId: owner.id, active: true },
        });
      const benchRecord = () =>
        db.personalRecord.findUniqueOrThrow({
          where: {
            userId_exerciseId: { userId: owner.id, exerciseId: bench.id },
          },
        });

      const first = await train(100);
      const second = await train(102.5);
      const firstRecordKey = `session:${first}:pr:${bench.id}:v1`;
      const secondRecordKey = `session:${second}:pr:${bench.id}:v1`;
      assert.ok(
        await db.trainingEvent.findUnique({ where: { eventKey: firstRecordKey } }),
      );
      const before = await routineState();
      const achievementsBefore = new Set(
        (
          await db.trainingEvent.findMany({
            where: { userId: owner.id, type: "ACHIEVEMENT_UNLOCKED" },
            select: { eventKey: true },
          })
        ).map((event) => event.eventKey),
      );

      const today = new Date();
      const daysAgo = (days: number) =>
        new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
      const request = {
        routineId: routine.id,
        routineDayId: day.id,
        date: daysAgo(3),
        sets: [
          { routineExerciseId: benchSlot.id, setNumber: 1, reps: 5, weight: 120, isCompleted: true },
          { routineExerciseId: benchSlot.id, setNumber: 2, reps: 5, weight: 120, isCompleted: true },
          { routineExerciseId: squatSlot.id, setNumber: 1, reps: 8, weight: 65, isCompleted: true },
        ],
      };

      // Refusals: a date on the routine's own day, the same day twice.
      await assert.rejects(
        logged.log(owner.id, { ...request, date: daysAgo(0) }),
        (error: unknown) =>
          error instanceof BadRequestException &&
          codeOf(error) === "LOGGED_WORKOUT_DATE",
      );
      const { session, analytics: status } = await logged.log(owner.id, request);
      assert.equal(session.origin, "LOGGED_LATER");
      assert.equal(session.status, "COMPLETED");
      assert.equal(status.state, "BUILDING");
      assert.equal(session.startedAt, `${daysAgo(3)}T12:00:00.000Z`);
      await assert.rejects(
        logged.log(owner.id, { ...request }),
        (error: unknown) =>
          error instanceof ConflictException &&
          codeOf(error) === "LOGGED_WORKOUT_SAME_DAY",
      );

      // The plan it trained: the 8-week slot one week back, at its load.
      const snapshot = await db.workoutSessionSnapshot.findUniqueOrThrow({
        where: { sessionId: session.id },
      });
      assert.equal(snapshot.provenance, "LOGGED");
      const payload = snapshot.payload as {
        routineDay: {
          exercises: Array<{
            id: string;
            linearPeriodization: { step: number } | null;
            sets: Array<{ weight: number | null }>;
          }>;
        };
      };
      const loggedSquat = payload.routineDay.exercises.find(
        (exercise) => exercise.id === squatSlot.id,
      )!;
      assert.equal(loggedSquat.linearPeriodization?.step, 2);
      assert.deepEqual(
        loggedSquat.sets.map((set) => set.weight),
        [65, 65, 65],
      );

      // Never announced, never correctable, never moving the routine.
      assert.equal(
        await db.trainingEvent.count({
          where: { sessionId: session.id, type: "SESSION_COMPLETED" },
        }),
        0,
      );
      assert.equal(
        await db.trainingEvent.count({
          where: { sessionId: session.id, type: "PROGRESSION_CHANGED" },
        }),
        0,
      );
      assert.equal(
        (await corrections.getCorrections(owner.id, session.id)).window
          .closedReason,
        "LOGGED_LATER",
      );
      assert.equal(await routineState(), before, "the routine moved");

      await replay();
      const rebuilt = await active();
      assert.equal(rebuilt.completedSessions, 3);
      assert.equal(rebuilt.totalVolumeKg, 2 * 500 + 2 * 512.5 + 2 * 600 + 65 * 8);
      // The heavier set logged earlier retires the live records it beats.
      assert.equal(
        await db.trainingEvent.count({
          where: { eventKey: { in: [firstRecordKey, secondRecordKey] } },
        }),
        0,
      );
      assert.equal((await benchRecord()).sessionId, session.id);
      assert.equal((await benchRecord()).weight, 120);
      assert.equal(await routineState(), before, "the replay moved the routine");
      // Anything first reached in the replay is recognized from history.
      const replayed = await db.trainingEvent.findMany({
        where: { userId: owner.id, type: "ACHIEVEMENT_UNLOCKED" },
        select: { eventKey: true, payload: true },
      });
      for (const event of replayed) {
        if (achievementsBefore.has(event.eventKey)) continue;
        assert.equal(
          (event.payload as { backfilled: boolean }).backfilled,
          true,
          event.eventKey,
        );
      }

      // The social reads leave its events out, and keep events with no session.
      const loggedIds = await loggedLaterSessionIds(db, [owner.id]);
      assert.deepEqual(loggedIds, [session.id]);
      await db.trainingEvent.create({
        data: {
          eventKey: `logged-test:${owner.id}:sessionless`,
          userId: owner.id,
          type: "ACHIEVEMENT_UNLOCKED",
          occurredAt: new Date(),
          payload: { backfilled: true },
        },
      });
      const social = await db.trainingEvent.findMany({
        where: { userId: owner.id, ...notFromSessions(loggedIds) },
        select: { sessionId: true },
      });
      assert.ok(social.every((event) => event.sessionId !== session.id));
      assert.ok(social.some((event) => event.sessionId === null));
      assert.ok(
        await db.trainingEvent.count({ where: { sessionId: session.id } }),
        "its own record is still there for its member",
      );

      // A live workout cannot be removed this way; the logged one can.
      await assert.rejects(
        logged.remove(owner.id, second),
        (error: unknown) =>
          error instanceof ConflictException &&
          codeOf(error) === "LOGGED_WORKOUT_NOT_LOGGED",
      );
      const removed = await logged.remove(owner.id, session.id);
      assert.equal(removed.analytics.state, "BUILDING");
      assert.equal(
        await db.workoutSession.count({ where: { id: session.id } }),
        0,
      );
      await replay();
      assert.equal((await active()).completedSessions, 2);
      assert.ok(
        await db.trainingEvent.findUnique({ where: { eventKey: secondRecordKey } }),
        "the live record is back under its own key",
      );
      assert.equal((await benchRecord()).sessionId, second);
      assert.equal(await routineState(), before);
    } finally {
      await cleanUp();
      await db.$disconnect();
    }
  },
);
