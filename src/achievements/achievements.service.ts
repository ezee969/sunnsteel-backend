import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AchievementCategoryProgress,
  ACHIEVEMENT_DEFINITIONS,
  AchievementsResponse,
  AchievementUnlockedEventPayload,
  COMEBACK_SESSION_LOOKBACK,
  EarnedAchievement,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { lockTrainingAccount } from '../workouts/analytics/analytics-lock';
import {
  achievementCategoryProgress,
  achievementTotals,
  awardMilestoneAchievements,
} from './achievement-events';
import { comebackRecognitionSummary } from './comeback-recognition';
import { renaissanceRankProgress } from './renaissance-ranks';

export function parseAchievementEvent(
  event: {
    id: string;
    sessionId: string | null;
    occurredAt: Date;
    payload: Prisma.JsonValue;
  },
): EarnedAchievement | null {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return null;
  }
  const payload = event.payload as unknown as AchievementUnlockedEventPayload;
  const definition = ACHIEVEMENT_DEFINITIONS.find(
    candidate => candidate.id === payload.id,
  );
  if (
    payload.schemaVersion !== 1 ||
    !definition ||
    payload.category !== definition.category ||
    payload.threshold !== definition.threshold ||
    typeof payload.backfilled !== 'boolean'
  ) {
    return null;
  }
  return {
    eventId: event.id,
    ...definition,
    unlockedAt: event.occurredAt.toISOString(),
    sourceSessionId: event.sessionId,
    backfilled: payload.backfilled,
  };
}

@Injectable()
export class AchievementsService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId: string): Promise<AchievementsResponse> {
    return this.db.$transaction(
      async tx => {
        await lockTrainingAccount(tx, userId);
        const projection = await tx.workoutAnalyticsProjection.findFirst({
          where: { userId, active: true, state: 'READY' },
        });
        let rank: AchievementsResponse['rank'] = null;
        let milestoneProgress: AchievementCategoryProgress[] = [];
        let comeback: AchievementsResponse['comeback'] = null;

        if (projection) {
          const [records, activeWeeks, completedSessionEvents] =
            await Promise.all([
              tx.personalRecord.count({ where: { userId } }),
              tx.workoutRollup.count({
                where: {
                  projectionId: projection.id,
                  period: 'WEEK',
                  sessions: { gt: 0 },
                },
              }),
              tx.trainingEvent.findMany({
                where: { userId, type: 'SESSION_COMPLETED' },
                orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
                take: COMEBACK_SESSION_LOOKBACK + 1,
                select: {
                  id: true,
                  sessionId: true,
                  occurredAt: true,
                },
              }),
            ]);
          const totals = achievementTotals(projection, records);
          await awardMilestoneAchievements(tx, {
            userId,
            sourceSessionId: null,
            occurredAt: new Date(),
            totals,
            backfilled: true,
          });
          rank = renaissanceRankProgress(
            projection.completedSessions,
            activeWeeks,
          );
          milestoneProgress = achievementCategoryProgress(totals);
          comeback = comebackRecognitionSummary(
            completedSessionEvents.slice(0, COMEBACK_SESSION_LOOKBACK),
            projection.timeZone,
            completedSessionEvents.length > COMEBACK_SESSION_LOOKBACK,
          );
        }

        const events = await tx.trainingEvent.findMany({
          where: { userId, type: 'ACHIEVEMENT_UNLOCKED' },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: ACHIEVEMENT_DEFINITIONS.length,
          select: {
            id: true,
            sessionId: true,
            occurredAt: true,
            payload: true,
          },
        });
        const achievements = events.flatMap(event => {
          const mapped = parseAchievementEvent(event);
          return mapped ? [mapped] : [];
        });
        return {
          analyticsReady: Boolean(projection),
          earnedCount: achievements.length,
          availableCount: ACHIEVEMENT_DEFINITIONS.length,
          achievements,
          rank,
          milestoneProgress,
          comeback,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
