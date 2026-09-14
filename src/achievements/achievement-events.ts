import { Prisma, WorkoutAnalyticsProjection } from '@prisma/client';
import {
  ACHIEVEMENT_DEFINITIONS,
  AchievementCategory,
  AchievementDefinition,
  AchievementUnlockedEventPayload,
  StreakMilestoneEventPayload,
} from '@sunsteel/contracts';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export interface AchievementTotals {
  sessions: number;
  sets: number;
  volumeKg: number;
  records: number;
  streakDays: number;
}

export function achievementTotals(
  projection: Pick<
    WorkoutAnalyticsProjection,
    | 'completedSessions'
    | 'completedSets'
    | 'totalVolumeKg'
    | 'bestRun'
  >,
  records: number,
): AchievementTotals {
  return {
    sessions: projection.completedSessions,
    sets: projection.completedSets,
    volumeKg: projection.totalVolumeKg,
    records,
    streakDays: projection.bestRun,
  };
}

function valueFor(
  totals: AchievementTotals,
  category: AchievementCategory,
): number {
  switch (category) {
    case 'SESSIONS':
      return totals.sessions;
    case 'SETS':
      return totals.sets;
    case 'VOLUME_KG':
      return totals.volumeKg;
    case 'RECORDS':
      return totals.records;
    case 'STREAK_DAYS':
      return totals.streakDays;
  }
}

export function reachedAchievements(
  totals: AchievementTotals,
): AchievementDefinition[] {
  return ACHIEVEMENT_DEFINITIONS.filter(
    definition => valueFor(totals, definition.category) >= definition.threshold,
  );
}

interface AwardMilestoneAchievementsInput {
  userId: string;
  sourceSessionId: string | null;
  occurredAt: Date;
  totals: AchievementTotals;
  backfilled: boolean;
}

/**
 * Writes one immutable event per reached catalog milestone. Unique event keys
 * make live finish retries, analytics rebuilds and history reconciliation safe.
 */
export async function awardMilestoneAchievements(
  tx: Prisma.TransactionClient,
  input: AwardMilestoneAchievementsInput,
): Promise<void> {
  for (const definition of reachedAchievements(input.totals)) {
    const payload: AchievementUnlockedEventPayload = {
      schemaVersion: 1,
      ...definition,
      backfilled: input.backfilled,
    };
    await tx.trainingEvent.upsert({
      where: {
        eventKey: `achievement:${input.userId}:${definition.id}:v1`,
      },
      update: {},
      create: {
        eventKey: `achievement:${input.userId}:${definition.id}:v1`,
        userId: input.userId,
        sessionId: input.sourceSessionId,
        type: 'ACHIEVEMENT_UNLOCKED',
        occurredAt: input.occurredAt,
        payload: json(payload),
      },
    });

    if (definition.category !== 'STREAK_DAYS') continue;
    const streakPayload: StreakMilestoneEventPayload = {
      schemaVersion: 1,
      achievementId: definition.id,
      streakDays: definition.threshold,
      backfilled: input.backfilled,
    };
    await tx.trainingEvent.upsert({
      where: {
        eventKey: `streak:${input.userId}:${definition.threshold}:v1`,
      },
      update: {},
      create: {
        eventKey: `streak:${input.userId}:${definition.threshold}:v1`,
        userId: input.userId,
        sessionId: input.sourceSessionId,
        type: 'STREAK_MILESTONE',
        occurredAt: input.occurredAt,
        payload: json(streakPayload),
      },
    });
  }
}
