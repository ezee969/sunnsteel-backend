import { progressionRuns } from '../session-training-block';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  type CorrectSessionResponse,
  type SessionCorrection,
  type SessionCorrectionsResponse,
  type SessionCorrectionWindow,
  type SessionSetCorrection,
  sessionCorrectionWindow,
} from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import {
  achievementTotals,
  awardMilestoneAchievements,
  reachedAchievements,
} from '../../achievements/achievement-events';
import { lockTrainingAccount } from '../analytics/analytics-lock';
import {
  contributionChecksum,
  localDate,
  sessionContribution,
  weekDate,
} from '../analytics/analytics-contribution';
import { ensureSessionSnapshot } from '../analytics/session-snapshot';
import { CorrectSessionDto } from '../dto/correct-session.dto';
import {
  buildProgressionOutcome,
  type ProgressionLog,
} from '../progression-changes';
import {
  applySetCorrections,
  beatsRecord,
  contributionDelta,
  correctedPrescription,
  type CorrectableLog,
  planSetCorrections,
  prescriptionIntact,
} from '../session-correction-rules';
import {
  excludeSubstitutedSlots,
  readSubstitutions,
} from '../session-substitutions';

type Tx = Prisma.TransactionClient;

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const CLOSED_MESSAGES: Record<string, string> = {
  NOT_COMPLETED: 'Only a completed workout can be corrected',
  NOT_LATEST: 'Only your most recent workout can be corrected',
  LATER_SESSION: 'This workout can no longer be corrected: another one has started since',
  WINDOW_PASSED: 'This workout can no longer be corrected: the correction window has passed',
  LIMIT_REACHED: 'This workout has been corrected as many times as allowed',
};

const progressionKey = (sessionId: string, routineExerciseId: string) =>
  `session:${sessionId}:progression:${routineExerciseId}:v1`;
const recordKey = (sessionId: string, exerciseId: string) =>
  `session:${sessionId}:pr:${exerciseId}:v1`;

function mapCorrection(row: {
  id: string;
  createdAt: Date;
  changes: Prisma.JsonValue;
}): SessionCorrection {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    changes: row.changes as unknown as SessionSetCorrection[],
  };
}

async function readWindow(
  db: Tx | DatabaseService,
  userId: string,
  session: { id: string; status: string; endedAt: Date | null },
  correctionCount: number,
): Promise<SessionCorrectionWindow> {
  const [laterCompleted, laterStarted] = session.endedAt
    ? await Promise.all([
        db.workoutSession.count({
          where: {
            userId,
            id: { not: session.id },
            status: 'COMPLETED',
            endedAt: { gt: session.endedAt },
          },
        }),
        db.workoutSession.count({
          where: {
            userId,
            id: { not: session.id },
            startedAt: { gt: session.endedAt },
          },
        }),
      ])
    : [0, 0];
  return sessionCorrectionWindow({
    status: session.status,
    endedAt: session.endedAt,
    isLatest: laterCompleted === 0,
    laterSessionStarted: laterStarted > 0,
    correctionCount,
  });
}

/**
 * LIVE-17. Corrects the set logs of the owner's most recent completed workout
 * and re-derives, in the same transaction and under the account lock, what
 * that workout fed: its totals, the analytics rollups, records, achievements,
 * its own load changes and the notification and activity built from them.
 *
 * Restricting corrections to the latest workout, before another starts, is
 * what makes this exact: nothing later has been measured against it, so its
 * contribution can be replaced in place rather than replaying history.
 */
@Injectable()
export class WorkoutSessionCorrectionService {
  constructor(private readonly db: DatabaseService) {}

  async getCorrections(
    userId: string,
    sessionId: string,
  ): Promise<SessionCorrectionsResponse> {
    const session = await this.db.workoutSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, status: true, endedAt: true },
    });
    if (!session) throw new NotFoundException('Workout session not found');
    const rows = await this.db.sessionCorrection.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      window: await readWindow(this.db, userId, session, rows.length),
      corrections: rows.map(mapCorrection),
    };
  }

  async correctSession(
    userId: string,
    sessionId: string,
    dto: CorrectSessionDto,
  ): Promise<CorrectSessionResponse> {
    return this.db.$transaction(
      async (tx) => {
        await lockTrainingAccount(tx, userId);
        const session = await tx.workoutSession.findFirst({
          where: { id: sessionId, userId },
        });
        if (!session) throw new NotFoundException('Workout session not found');
        const correctionCount = await tx.sessionCorrection.count({
          where: { sessionId },
        });
        const window = await readWindow(tx, userId, session, correctionCount);
        if (window.closedReason)
          throw new ConflictException({
            code: window.closedReason,
            message: CLOSED_MESSAGES[window.closedReason],
          });
        const endedAt = session.endedAt!;

        // A rebuilding generation replays sessions from its own cursor and
        // could have consumed this one already; correcting underneath it would
        // leave the new generation with the old numbers.
        const projections = await tx.workoutAnalyticsProjection.findMany({
          where: { userId, state: { in: ['READY', 'BUILDING'] } },
        });
        const projection = projections.find(
          (item) => item.active && item.state === 'READY',
        );
        if (!projection || projections.some((item) => item.state === 'BUILDING'))
          throw new ConflictException({
            code: 'ANALYTICS_REBUILDING',
            message:
              'Your training history is being rebuilt. Try again in a few minutes.',
          });

        const logs: CorrectableLog[] = await tx.setLog.findMany({
          where: { sessionId },
          orderBy: { id: 'asc' },
        });
        const exerciseNames = new Map(
          (
            await tx.exercise.findMany({
              where: { id: { in: [...new Set(logs.map((log) => log.exerciseId))] } },
              select: { id: true, name: true },
            })
          ).map((exercise) => [exercise.id, exercise.name]),
        );
        const changes = planSetCorrections(logs, dto.sets, exerciseNames);
        const corrected = applySetCorrections(logs, changes, endedAt);

        const snapshot = await ensureSessionSnapshot(tx, sessionId);
        const substitutions = readSubstitutions(session.exerciseSubstitutions);
        const before = sessionContribution(logs, snapshot, endedAt, substitutions);
        const after = sessionContribution(
          corrected,
          snapshot,
          endedAt,
          substitutions,
        );

        const byId = new Map(corrected.map((log) => [log.id, log]));
        for (const change of changes) {
          const log = byId.get(change.setLogId)!;
          await tx.setLog.update({
            where: { id: log.id },
            data: {
              weight: log.weight,
              reps: log.reps,
              rpe: log.rpe,
              isCompleted: log.isCompleted,
              completedAt: log.completedAt,
            },
          });
        }

        await tx.workoutSession.update({
          where: { id: sessionId },
          data: {
            totalVolumeKg: after.volumeKg,
            completedSets: after.completedSets,
          },
        });
        await tx.trainingEvent.updateMany({
          where: { eventKey: `session:${sessionId}:completed:v1` },
          data: {
            payload: json({
              schemaVersion: 1,
              volumeKg: after.volumeKg,
              completedSets: after.completedSets,
            }),
          },
        });

        const correctionId = randomUUID();
        const updatedProjection = await this.replaceContribution(
          tx,
          projection,
          sessionId,
          endedAt,
          before,
          after,
          correctionId,
        );
        const removedEntryKeys: string[] = [];
        await this.rederiveRecords(
          tx,
          userId,
          sessionId,
          projection.id,
          before,
          after,
          exerciseNames,
          removedEntryKeys,
        );
        await this.rederiveAchievements(
          tx,
          userId,
          sessionId,
          endedAt,
          updatedProjection,
          removedEntryKeys,
        );
        // ROUT-16: a deload session had no progression to re-derive.
        const progressionKept = !progressionRuns(session)
          ? []
          : await this.rederiveProgression(
          tx,
          userId,
          sessionId,
          endedAt,
          snapshot.routineDay.exercises ?? [],
          logs,
          corrected,
          substitutions,
          removedEntryKeys,
        );
        await this.refreshSessionNotification(tx, userId, sessionId);
        await this.removeActivityEntries(tx, userId, removedEntryKeys);

        const row = await tx.sessionCorrection.create({
          data: {
            id: correctionId,
            sessionId,
            userId,
            changes: json(changes),
          },
        });
        return {
          correction: mapCorrection(row),
          window: await readWindow(tx, userId, session, correctionCount + 1),
          progressionKept,
        };
      },
      { timeout: 20000 },
    );
  }

  /** Swaps this workout's old contribution for the corrected one, in place. */
  private async replaceContribution(
    tx: Tx,
    projection: { id: string; timeZone: string; checksum: string },
    sessionId: string,
    endedAt: Date,
    before: ReturnType<typeof sessionContribution>,
    after: ReturnType<typeof sessionContribution>,
    correctionId: string,
  ) {
    const delta = contributionDelta(before, after);
    const date = localDate(endedAt, projection.timeZone);
    for (const periodDate of [
      ['DAY', date],
      ['WEEK', weekDate(date)],
    ] as const) {
      const key = {
        projectionId: projection.id,
        period: periodDate[0],
        date: periodDate[1],
      };
      await tx.workoutRollup.updateMany({
        where: key,
        data: {
          volumeKg: { increment: delta.volumeKg },
          completedSets: { increment: delta.completedSets },
        },
      });
      for (const [muscle, values] of delta.muscles) {
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
    // The chain cannot be unwound, so the correction is chained onto it: a
    // later rebuild reaches the same totals by a different path.
    return tx.workoutAnalyticsProjection.update({
      where: { id: projection.id },
      data: {
        totalVolumeKg: { increment: delta.volumeKg },
        completedSets: { increment: delta.completedSets },
        checksum: contributionChecksum(
          projection.checksum,
          `${sessionId}:correction:${correctionId}`,
          endedAt,
          after,
        ),
      },
    });
  }

  /**
   * Each exercise this workout touched is measured again against every other
   * completed workout. A set that still beats them keeps (or gains) this
   * workout's record, with its corrected numbers; one that no longer does
   * gives the record back to the best earlier set, or to nobody.
   */
  private async rederiveRecords(
    tx: Tx,
    userId: string,
    sessionId: string,
    projectionId: string,
    before: ReturnType<typeof sessionContribution>,
    after: ReturnType<typeof sessionContribution>,
    exerciseNames: Map<string, string>,
    removedEntryKeys: string[],
  ) {
    const exerciseIds = new Set([
      ...before.records.map((record) => record.exerciseId),
      ...after.records.map((record) => record.exerciseId),
    ]);
    for (const exerciseId of exerciseIds) {
      const prior = await tx.setLog.findFirst({
        where: {
          exerciseId,
          isCompleted: true,
          weight: { gt: 0 },
          reps: { gt: 0 },
          sessionId: { not: sessionId },
          session: { userId, status: 'COMPLETED' },
        },
        orderBy: [
          { weight: 'desc' },
          { reps: 'desc' },
          { completedAt: { sort: 'asc', nulls: 'last' } },
        ],
        select: {
          id: true,
          sessionId: true,
          weight: true,
          reps: true,
          completedAt: true,
          session: { select: { endedAt: true } },
        },
      });
      const priorSet = prior
        ? { weight: prior.weight!, reps: prior.reps! }
        : null;
      const current = after.records.find(
        (record) => record.exerciseId === exerciseId,
      );
      const eventKey = recordKey(sessionId, exerciseId);
      const frontierKey = { projectionId, exerciseId };
      const globalKey = { userId, exerciseId };

      if (current && beatsRecord(current, priorSet)) {
        const payload = json({ schemaVersion: 1, ...current });
        await tx.trainingEvent.upsert({
          where: { eventKey },
          create: {
            eventKey,
            userId,
            sessionId,
            type: 'PERSONAL_RECORD',
            occurredAt: current.achievedAt,
            payload,
          },
          update: { occurredAt: current.achievedAt, payload },
        });
        await tx.analyticsRecordFrontier.upsert({
          where: { projectionId_exerciseId: frontierKey },
          create: { ...frontierKey, weight: current.weight, reps: current.reps },
          update: { weight: current.weight, reps: current.reps },
        });
        const values = { ...current, userId, sessionId };
        await tx.personalRecord.upsert({
          where: { userId_exerciseId: globalKey },
          create: values,
          update: values,
        });
        continue;
      }

      const removed = await tx.trainingEvent.deleteMany({ where: { eventKey } });
      if (removed.count) removedEntryKeys.push(eventKey);
      if (!prior) {
        await tx.analyticsRecordFrontier.deleteMany({ where: frontierKey });
        await tx.personalRecord.deleteMany({ where: globalKey });
        continue;
      }
      await tx.analyticsRecordFrontier.upsert({
        where: { projectionId_exerciseId: frontierKey },
        create: { ...frontierKey, ...priorSet! },
        update: priorSet!,
      });
      const values = {
        userId,
        exerciseId,
        exerciseName:
          exerciseNames.get(exerciseId) ??
          (
            await tx.exercise.findUnique({
              where: { id: exerciseId },
              select: { name: true },
            })
          )?.name ??
          'Exercise',
        sessionId: prior.sessionId,
        setLogId: prior.id,
        weight: prior.weight!,
        reps: prior.reps!,
        estimated1rm:
          Math.round(prior.weight! * (1 + prior.reps! / 30) * 10) / 10,
        achievedAt: prior.completedAt ?? prior.session.endedAt ?? new Date(),
      };
      await tx.personalRecord.upsert({
        where: { userId_exerciseId: globalKey },
        create: values,
        update: values,
      });
    }
  }

  /**
   * A milestone this workout unlocked stays only while the corrected totals
   * still reach it; one they now reach is awarded as it would have been at
   * finish. Earlier workouts' milestones cannot be affected: they were
   * reached before this workout added anything.
   */
  private async rederiveAchievements(
    tx: Tx,
    userId: string,
    sessionId: string,
    endedAt: Date,
    projection: Parameters<typeof achievementTotals>[0],
    removedEntryKeys: string[],
  ) {
    const recordCount = await tx.trainingEvent.count({
      where: { userId, type: 'PERSONAL_RECORD', occurredAt: { lte: endedAt } },
    });
    const totals = achievementTotals(projection, recordCount);
    const reached = new Set(
      reachedAchievements(totals).map((definition) => definition.id),
    );
    const unlocked = await tx.trainingEvent.findMany({
      where: { userId, sessionId, type: 'ACHIEVEMENT_UNLOCKED' },
      select: { eventKey: true, payload: true },
    });
    for (const event of unlocked) {
      const id = (event.payload as { id?: string } | null)?.id;
      if (!id || reached.has(id)) continue;
      await tx.trainingEvent.delete({ where: { eventKey: event.eventKey } });
      await tx.notification.deleteMany({
        where: { userId, sourceKey: `achievement:${id}` },
      });
      removedEntryKeys.push(event.eventKey);
    }
    await awardMilestoneAchievements(tx, {
      userId,
      sourceSessionId: sessionId,
      occurredAt: endedAt,
      totals,
      backfilled: false,
    });
  }

  /**
   * Re-runs this workout's progression over the corrected sets, for every
   * routine exercise whose sets still read exactly what the finish wrote.
   * Where the owner has changed them since, their change wins and the load
   * change is reported as kept.
   */
  private async rederiveProgression(
    tx: Tx,
    userId: string,
    sessionId: string,
    endedAt: Date,
    exercises: Parameters<typeof buildProgressionOutcome>[0],
    logs: CorrectableLog[],
    corrected: CorrectableLog[],
    substitutions: ReturnType<typeof readSubstitutions>,
    removedEntryKeys: string[],
  ) {
    const toProgressionLogs = (items: CorrectableLog[]) =>
      excludeSubstitutedSlots(
        items.flatMap((log): ProgressionLog[] => {
          const routineExerciseId =
            log.sourceRoutineExerciseId ?? log.routineExerciseId;
          if (!routineExerciseId) return [];
          return [
            {
              routineExerciseId,
              setNumber: log.setNumber,
              reps: log.reps ?? null,
              weight: typeof log.weight === 'number' ? log.weight : null,
              isCompleted: log.isCompleted,
            },
          ];
        }),
        substitutions,
      );
    const finish = buildProgressionOutcome(exercises, toProgressionLogs(logs));
    const now = buildProgressionOutcome(exercises, toProgressionLogs(corrected));
    const kept: CorrectSessionResponse['progressionKept'] = [];

    for (const exercise of exercises) {
      const finishUpdates = finish.updates.filter(
        (update) => update.routineExerciseId === exercise.id,
      );
      const nowUpdates = now.updates.filter(
        (update) => update.routineExerciseId === exercise.id,
      );
      const finishChange = finish.changes.find(
        (change) => change.routineExerciseId === exercise.id,
      );
      const nowChange = now.changes.find(
        (change) => change.routineExerciseId === exercise.id,
      );
      if (
        JSON.stringify(finishUpdates) === JSON.stringify(nowUpdates) &&
        JSON.stringify(finishChange ?? null) === JSON.stringify(nowChange ?? null)
      )
        continue;

      const current = await tx.routineExerciseSet.findMany({
        where: { routineExerciseId: exercise.id },
        select: { setNumber: true, weight: true },
      });
      if (!prescriptionIntact(exercise.sets, current, finishUpdates)) {
        kept.push({
          exerciseId: exercise.exerciseId ?? exercise.exercise.id ?? '',
          exerciseName: exercise.exercise.name,
        });
        continue;
      }
      const currentWeights = new Map(
        current.map((set) => [set.setNumber, set.weight]),
      );
      for (const set of correctedPrescription(exercise.sets, nowUpdates)) {
        if ((currentWeights.get(set.setNumber) ?? null) === set.weight) continue;
        await tx.routineExerciseSet.update({
          where: {
            routineExerciseId_setNumber: {
              routineExerciseId: exercise.id,
              setNumber: set.setNumber,
            },
          },
          data: { weight: set.weight },
          select: { id: true },
        });
      }
      const eventKey = progressionKey(sessionId, exercise.id);
      if (nowChange) {
        const payload = json({ schemaVersion: 1, ...nowChange });
        await tx.trainingEvent.upsert({
          where: { eventKey },
          create: {
            eventKey,
            userId,
            sessionId,
            type: 'PROGRESSION_CHANGED',
            occurredAt: endedAt,
            payload,
          },
          update: { payload },
        });
      } else {
        const removed = await tx.trainingEvent.deleteMany({
          where: { eventKey },
        });
        if (removed.count) removedEntryKeys.push(eventKey);
      }
    }
    return kept;
  }

  /**
   * The session note in the notification centre counts this workout's
   * records and load changes. It was written once; correct its counts, or
   * remove it when nothing is left to announce.
   */
  private async refreshSessionNotification(
    tx: Tx,
    userId: string,
    sessionId: string,
  ) {
    const note = await tx.notification.findUnique({
      where: { userId_sourceKey: { userId, sourceKey: `session:${sessionId}` } },
    });
    if (!note) return;
    const [records, progressions] = await Promise.all([
      tx.trainingEvent.count({
        where: { userId, sessionId, type: 'PERSONAL_RECORD' },
      }),
      tx.trainingEvent.count({
        where: { userId, sessionId, type: 'PROGRESSION_CHANGED' },
      }),
    ]);
    if (records === 0 && progressions === 0) {
      await tx.notification.delete({ where: { id: note.id } });
      return;
    }
    await tx.notification.update({
      where: { id: note.id },
      data: {
        payload: json({
          ...((note.payload as Record<string, unknown>) ?? {}),
          recordCount: records,
          progressionCount: progressions,
        }),
      },
    });
  }

  /**
   * An activity entry is generated from its event, so an event that no
   * longer holds takes its entry away. What hung from that entry -- its
   * reactions, comments, their notifications and the owner's audience for it
   * -- was about a fact that did not happen, and goes with it.
   */
  private async removeActivityEntries(
    tx: Tx,
    userId: string,
    entryKeys: string[],
  ) {
    if (entryKeys.length === 0) return;
    const comments = await tx.activityComment.findMany({
      where: { entryKey: { in: entryKeys }, authorId: userId },
      select: { id: true },
    });
    if (comments.length)
      await tx.notification.deleteMany({
        where: {
          userId,
          sourceKey: { in: comments.map((comment) => `comment:${comment.id}`) },
        },
      });
    await tx.activityComment.deleteMany({
      where: { entryKey: { in: entryKeys }, authorId: userId },
    });
    await tx.activityEntryReaction.deleteMany({
      where: { entryKey: { in: entryKeys }, authorId: userId },
    });
    await tx.activityEntryOverride.deleteMany({
      where: { userId, entryKey: { in: entryKeys } },
    });
  }
}
