import { Prisma, WorkoutAnalyticsProjection } from '@prisma/client';
import { ensureSessionSnapshot } from './session-snapshot';
import {
  contributionChecksum,
  localDate,
  nextStreak,
  sessionContribution,
  weekDate,
} from './analytics-contribution';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Caller holds the account lock. Never called for an aborted session. */
export async function summarizeSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
) {
  const snapshot = await ensureSessionSnapshot(tx, sessionId);
  const session = await tx.workoutSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  if (session.status !== 'COMPLETED' || !session.endedAt)
    throw new Error('Session is not completed');
  const logs = await tx.setLog.findMany({
    where: { sessionId },
    orderBy: { id: 'asc' },
  });
  const contribution = sessionContribution(logs, snapshot, session.endedAt);
  await tx.workoutSession.update({
    where: { id: sessionId },
    data: {
      totalVolumeKg: contribution.volumeKg,
      completedSets: contribution.completedSets,
    },
  });
  await tx.trainingEvent.upsert({
    where: { eventKey: `session:${sessionId}:completed:v1` },
    update: {},
    create: {
      eventKey: `session:${sessionId}:completed:v1`,
      userId: session.userId,
      sessionId,
      type: 'SESSION_COMPLETED',
      occurredAt: session.endedAt,
      payload: json({
        schemaVersion: 1,
        volumeKg: contribution.volumeKg,
        completedSets: contribution.completedSets,
      }),
    },
  });
  return { session, contribution };
}

export async function applyContribution(
  tx: Prisma.TransactionClient,
  projection: WorkoutAnalyticsProjection,
  summary: Awaited<ReturnType<typeof summarizeSession>>,
) {
  const { session, contribution } = summary;
  const date = localDate(session.endedAt!, projection.timeZone);
  const dayKey = { projectionId: projection.id, period: 'DAY', date };
  const day = await tx.workoutRollup.findUnique({
    where: { projectionId_period_date: dayKey },
  });
  for (const [period, periodDate] of [
    ['DAY', date],
    ['WEEK', weekDate(date)],
  ]) {
    const key = { projectionId: projection.id, period, date: periodDate };
    const values = {
      volumeKg: contribution.volumeKg,
      completedSets: contribution.completedSets,
      sessions: 1,
      activeDays: day ? 0 : 1,
    };
    await tx.workoutRollup.upsert({
      where: { projectionId_period_date: key },
      create: { ...key, ...values },
      update: {
        volumeKg: { increment: values.volumeKg },
        completedSets: { increment: values.completedSets },
        sessions: { increment: 1 },
        activeDays: { increment: values.activeDays },
      },
    });
    for (const [muscle, values] of contribution.muscles) {
      const muscleKey = { ...key, muscle };
      await tx.workoutMuscleRollup.upsert({
        where: { projectionId_period_date_muscle: muscleKey },
        create: { ...muscleKey, ...values },
        update: {
          volumeKg: { increment: values.volumeKg },
          completedSets: { increment: values.completedSets },
        },
      });
    }
  }
  // A generation-local record frontier reconstructs the historical PR sequence,
  // even if a newer global record was already written during dual-write.
  for (const record of contribution.records) {
    const key = { projectionId: projection.id, exerciseId: record.exerciseId };
    const previous = await tx.analyticsRecordFrontier.findUnique({
      where: { projectionId_exerciseId: key },
    });
    const beats =
      !previous ||
      record.weight > previous.weight ||
      (record.weight === previous.weight && record.reps > previous.reps);
    if (!beats) continue;
    await tx.analyticsRecordFrontier.upsert({
      where: { projectionId_exerciseId: key },
      create: { ...key, weight: record.weight, reps: record.reps },
      update: { weight: record.weight, reps: record.reps },
    });
    const eventKey = `session:${session.id}:pr:${record.exerciseId}:v1`;
    await tx.trainingEvent.upsert({
      where: { eventKey },
      update: {},
      create: {
        eventKey,
        userId: session.userId,
        sessionId: session.id,
        type: 'PERSONAL_RECORD',
        occurredAt: record.achievedAt,
        payload: json({ schemaVersion: 1, ...record }),
      },
    });
    const globalKey = { userId: session.userId, exerciseId: record.exerciseId };
    const global = await tx.personalRecord.findUnique({
      where: { userId_exerciseId: globalKey },
    });
    if (
      !global ||
      record.weight > global.weight ||
      (record.weight === global.weight &&
        (record.reps > global.reps ||
          (record.reps === global.reps &&
            record.achievedAt < global.achievedAt)))
    ) {
      const values = {
        ...record,
        userId: session.userId,
        sessionId: session.id,
      };
      await tx.personalRecord.upsert({
        where: { userId_exerciseId: globalKey },
        create: values,
        update: values,
      });
    }
  }
  return tx.workoutAnalyticsProjection.update({
    where: { id: projection.id },
    data: {
      totalVolumeKg: { increment: contribution.volumeKg },
      completedSets: { increment: contribution.completedSets },
      completedSessions: { increment: 1 },
      ...nextStreak(projection, date),
      checksum: contributionChecksum(
        projection.checksum,
        session.id,
        session.endedAt!,
        contribution,
      ),
    },
  });
}
