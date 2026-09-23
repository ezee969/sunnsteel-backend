import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { reachedAchievements, achievementTotals } from '../src/achievements/achievement-events';
import { WorkoutSessionCorrectionService } from '../src/workouts/services/workout-session-correction.service';
import { WorkoutSessionFinishService } from '../src/workouts/services/workout-session-finish.service';
import { WorkoutSessionLogService } from '../src/workouts/services/workout-session-log.service';
import { WorkoutSessionStartService } from '../src/workouts/services/workout-session-start.service';
import { WorkoutSessionReadService } from '../src/workouts/workout-session-read.service';

const enabled = process.env.ANALYTICS_TEST_DATABASE === 'isolated';

/**
 * LIVE-17 on real PostgreSQL. Two workouts are finished through the real
 * services with an active projection, the second with a 1000 kg typo; it is
 * then corrected twice. Every derived row is read back: set logs, session
 * totals, rollups, the projection, records and their frontier, the load
 * change and the routine it wrote, achievements, activity attached to a
 * record that no longer holds, and the audit trail.
 */
test(
  'session corrections on real PostgreSQL: every derived row follows the corrected sets',
  { skip: !enabled },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/td27_test');
    const db = new DatabaseService();
    const emails = ['correcting@isolated.test', 'reacting@isolated.test'];
    const cleanUp = async () => {
      await db.user.deleteMany({ where: { email: { in: emails } } });
      await db.exercise.deleteMany({ where: { name: 'Correction Bench' } });
    };
    await cleanUp();
    try {
      const owner = await db.user.create({
        data: { email: 'correcting@isolated.test', username: 'correct_owner', name: 'Owner', timeZone: 'UTC' },
      });
      const other = await db.user.create({
        data: { email: 'reacting@isolated.test', username: 'correct_other', name: 'Other' },
      });
      const exercise = await db.exercise.create({
        data: {
          name: 'Correction Bench',
          equipment: 'barbell',
          primaryMuscles: ['PECTORAL'],
          secondaryMuscles: ['TRICEPS'],
        },
      });
      const routine = await db.routine.create({
        data: {
          userId: owner.id,
          name: 'Correction programme',
          days: {
            create: {
              dayOfWeek: null,
              exercises: {
                create: {
                  exerciseId: exercise.id,
                  progressionScheme: 'DOUBLE_PROGRESSION',
                  minWeightIncrement: 2.5,
                  sets: {
                    create: [
                      { setNumber: 1, reps: 5, weight: 100 },
                      { setNumber: 2, reps: 5, weight: 100 },
                    ],
                  },
                },
              },
            },
          },
        },
        include: { days: { include: { exercises: true } } },
      });
      const day = routine.days[0];
      const slot = day.exercises[0];
      await db.workoutAnalyticsProjection.create({
        data: { userId: owner.id, timeZone: 'UTC', state: 'READY', active: true },
      });

      const reads = new WorkoutSessionReadService(db);
      const starts = new WorkoutSessionStartService(db, reads);
      const sets = new WorkoutSessionLogService(db);
      const finishes = new WorkoutSessionFinishService(db);
      const corrections = new WorkoutSessionCorrectionService(db);
      const train = async (performed: Array<[number, number]>) => {
        const session = await starts.startSession(owner.id, {
          routineId: routine.id,
          routineDayId: day.id,
        });
        for (const [index, [weight, reps]] of performed.entries())
          await sets.upsertSetLog(owner.id, session.id, {
            routineExerciseId: slot.id,
            exerciseId: exercise.id,
            setNumber: index + 1,
            weight,
            reps,
            isCompleted: true,
          });
        await finishes.finishSession(owner.id, session.id, { status: 'COMPLETED' });
        return session.id;
      };
      const routineWeights = async () =>
        (
          await db.routineExerciseSet.findMany({
            where: { routineExerciseId: slot.id },
            orderBy: { setNumber: 'asc' },
          })
        ).map((set) => set.weight);
      const projection = () =>
        db.workoutAnalyticsProjection.findFirstOrThrow({
          where: { userId: owner.id, active: true },
        });
      const achievementsHold = async () => {
        const current = await projection();
        const records = await db.trainingEvent.count({
          where: { userId: owner.id, type: 'PERSONAL_RECORD' },
        });
        const reached = new Set(
          reachedAchievements(achievementTotals(current, records)).map((item) => item.id),
        );
        const unlocked = await db.trainingEvent.findMany({
          where: { userId: owner.id, type: 'ACHIEVEMENT_UNLOCKED' },
        });
        for (const event of unlocked)
          assert.ok(
            reached.has((event.payload as { id: string }).id),
            `${(event.payload as { id: string }).id} is no longer reached`,
          );
      };

      const first = await train([
        [100, 5],
        [100, 5],
      ]);
      assert.deepEqual(await routineWeights(), [102.5, 102.5]);
      const second = await train([
        [1000, 5],
        [102.5, 5],
      ]);
      assert.deepEqual(await routineWeights(), [1002.5, 105], 'the typo reached the routine');
      assert.equal((await projection()).totalVolumeKg, 1000 + 5512.5);
      const recordKey = `session:${second}:pr:${exercise.id}:v1`;
      assert.equal(
        ((await db.trainingEvent.findUniqueOrThrow({ where: { eventKey: recordKey } })).payload as { weight: number }).weight,
        1000,
      );

      // The earlier workout is closed: the later one was built on it.
      await assert.rejects(
        corrections.correctSession(owner.id, first, {
          sets: [],
        }),
        (error: unknown) =>
          error instanceof ConflictException &&
          (error.getResponse() as { code: string }).code === 'NOT_LATEST',
      );
      const opened = await corrections.getCorrections(owner.id, second);
      assert.equal(opened.window.closedReason, null);
      assert.ok(opened.window.correctableUntil);

      const logs = await db.setLog.findMany({
        where: { sessionId: second },
        orderBy: { setNumber: 'asc' },
      });
      const secondSet = logs[1];

      // Correction A: the typo was 102.5 for 4 reps.
      const a = await corrections.correctSession(owner.id, second, {
        sets: [
          { setLogId: logs[0].id, weight: 102.5, reps: 4, rpe: null, isCompleted: true },
          { setLogId: secondSet.id, weight: 102.5, reps: 5, rpe: null, isCompleted: true },
        ],
      });
      assert.equal(a.correction.changes.length, 1, 'the unchanged set is not recorded');
      assert.deepEqual(a.correction.changes[0].before, {
        weight: 1000,
        reps: 5,
        rpe: null,
        isCompleted: true,
      });
      assert.deepEqual(a.progressionKept, []);

      const session = await db.workoutSession.findUniqueOrThrow({ where: { id: second } });
      assert.equal(session.totalVolumeKg, 102.5 * 4 + 102.5 * 5);
      assert.equal(
        ((await db.trainingEvent.findUniqueOrThrow({
          where: { eventKey: `session:${second}:completed:v1` },
        })).payload as { volumeKg: number }).volumeKg,
        922.5,
      );
      const afterA = await projection();
      assert.equal(afterA.totalVolumeKg, 1000 + 922.5);
      assert.equal(afterA.completedSets, 4);
      assert.equal(afterA.completedSessions, 2);
      const dayRollups = await db.workoutRollup.findMany({
        where: { projectionId: afterA.id, period: 'DAY' },
      });
      assert.equal(
        dayRollups.reduce((sum, row) => sum + row.volumeKg, 0),
        1922.5,
      );
      const chest = await db.workoutMuscleRollup.findMany({
        where: { projectionId: afterA.id, period: 'DAY', muscle: 'PECTORAL' },
      });
      assert.equal(chest.reduce((sum, row) => sum + row.volumeKg, 0), 1922.5);

      // The corrected workout still holds the record, at its real numbers.
      const recordA = await db.trainingEvent.findUniqueOrThrow({ where: { eventKey: recordKey } });
      assert.deepEqual(
        [
          (recordA.payload as { weight: number }).weight,
          (recordA.payload as { reps: number }).reps,
          (recordA.payload as { setLogId: string }).setLogId,
        ],
        [102.5, 5, secondSet.id],
      );
      const bestA = await db.personalRecord.findUniqueOrThrow({
        where: { userId_exerciseId: { userId: owner.id, exerciseId: exercise.id } },
      });
      assert.equal(bestA.weight, 102.5);
      assert.equal(bestA.setLogId, secondSet.id);

      // One set missed its target, so no load change, and the routine is back
      // to the weights actually lifted.
      assert.equal(
        await db.trainingEvent.count({
          where: { eventKey: `session:${second}:progression:${slot.id}:v1` },
        }),
        0,
      );
      assert.deepEqual(await routineWeights(), [102.5, 102.5]);
      await achievementsHold();

      // Somebody reacted to and commented on the record, and the owner edited
      // the routine by hand.
      await db.activityEntryReaction.create({
        data: { userId: other.id, entryKey: recordKey, authorId: owner.id, reaction: 'STRENGTH' },
      });
      await db.activityComment.create({
        data: { userId: other.id, entryKey: recordKey, authorId: owner.id, body: 'Big lift' },
      });
      await db.routineExerciseSet.update({
        where: { routineExerciseId_setNumber: { routineExerciseId: slot.id, setNumber: 2 } },
        data: { weight: 110 },
      });

      // Correction B: it was really 90 kg, below the earlier best.
      const b = await corrections.correctSession(owner.id, second, {
        sets: [
          { setLogId: logs[0].id, weight: 90, reps: 4, rpe: null, isCompleted: true },
          { setLogId: secondSet.id, weight: 90, reps: 5, rpe: 7, isCompleted: true },
        ],
      });
      assert.equal(b.correction.changes.length, 2);
      assert.deepEqual(b.progressionKept, [
        { exerciseId: exercise.id, exerciseName: 'Correction Bench' },
      ]);
      assert.deepEqual(await routineWeights(), [102.5, 110], 'the owner edit wins');

      assert.equal(await db.trainingEvent.count({ where: { eventKey: recordKey } }), 0);
      const bestB = await db.personalRecord.findUniqueOrThrow({
        where: { userId_exerciseId: { userId: owner.id, exerciseId: exercise.id } },
      });
      assert.equal(bestB.sessionId, first, 'the record returns to the earlier workout');
      assert.equal(bestB.weight, 100);
      const frontier = await db.analyticsRecordFrontier.findUniqueOrThrow({
        where: { projectionId_exerciseId: { projectionId: afterA.id, exerciseId: exercise.id } },
      });
      assert.deepEqual([frontier.weight, frontier.reps], [100, 5]);
      assert.equal(
        await db.activityEntryReaction.count({ where: { entryKey: recordKey } }),
        0,
      );
      assert.equal(await db.activityComment.count({ where: { entryKey: recordKey } }), 0);
      assert.equal((await projection()).totalVolumeKg, 1000 + 90 * 9);
      await achievementsHold();

      const trail = await corrections.getCorrections(owner.id, second);
      assert.deepEqual(
        trail.corrections.map((item) => item.id),
        [a.correction.id, b.correction.id],
      );
      assert.equal(trail.corrections[1].changes[1].after.rpe, 7);

      // Starting another workout closes the window.
      await starts.startSession(owner.id, { routineId: routine.id, routineDayId: day.id });
      assert.equal(
        (await corrections.getCorrections(owner.id, second)).window.closedReason,
        'LATER_SESSION',
      );

    } finally {
      await cleanUp();
      await db.$disconnect();
    }
  },
);
