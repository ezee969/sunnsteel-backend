import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACHIEVEMENT_DEFINITIONS,
  AchievementsResponse,
  AchievementUnlockedEventPayload,
  EarnedAchievement,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { lockTrainingAccount } from '../workouts/analytics/analytics-lock';
import {
  achievementTotals,
  awardMilestoneAchievements,
} from './achievement-events';

function parseAchievement(
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

        if (projection) {
          const records = await tx.personalRecord.count({ where: { userId } });
          await awardMilestoneAchievements(tx, {
            userId,
            sourceSessionId: null,
            occurredAt: new Date(),
            totals: achievementTotals(projection, records),
            backfilled: true,
          });
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
          const mapped = parseAchievement(event);
          return mapped ? [mapped] : [];
        });
        return {
          analyticsReady: Boolean(projection),
          earnedCount: achievements.length,
          availableCount: ACHIEVEMENT_DEFINITIONS.length,
          achievements,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
