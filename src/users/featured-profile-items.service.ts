import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ACHIEVEMENT_DEFINITIONS,
  FeaturedProfileItem,
  FeaturedProfileSelection,
  FeaturedProfileSelectionInput,
  FeaturedProfileSelectionsResponse,
  FEATURED_PROFILE_ITEMS_MAX,
  PersonalRecordEntry,
  ProfileViewerAccess,
  RENAISSANCE_RANK_DEFINITIONS,
  RenaissanceRankDefinition,
} from '@sunsteel/contracts';
import { parseAchievementEvent } from '../achievements/achievements.service';
import { renaissanceRankProgress } from '../achievements/renaissance-ranks';
import { DatabaseService } from '../database/database.service';
import { lockTrainingAccount } from '../workouts/analytics/analytics-lock';

interface AvailableFeaturedItems {
  records: Map<string, PersonalRecordEntry>;
  achievements: Map<
    string,
    Extract<FeaturedProfileItem, { kind: 'ACHIEVEMENT' }>['achievement']
  >;
  ranks: Map<string, RenaissanceRankDefinition>;
}

@Injectable()
export class FeaturedProfileItemsService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId: string): Promise<FeaturedProfileSelectionsResponse> {
    const items = await this.db.featuredProfileItem.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
      select: { kind: true, referenceId: true, position: true },
    });
    return { items };
  }

  async replace(
    userId: string,
    input: FeaturedProfileSelectionInput[],
  ): Promise<FeaturedProfileSelectionsResponse> {
    const items = this.normalize(input);
    const available = await this.loadAvailable(userId, {
      records: items.some(item => item.kind === 'RECORD'),
      achievements: items.some(item => item.kind === 'ACHIEVEMENT'),
      ranks: items.some(item => item.kind === 'RANK'),
    });
    for (const item of items) {
      const isAvailable =
        item.kind === 'RECORD'
          ? available.records.has(item.referenceId)
          : item.kind === 'ACHIEVEMENT'
            ? available.achievements.has(item.referenceId)
            : available.ranks.has(item.referenceId);
      if (!isAvailable) {
        throw new BadRequestException(
          'A featured item is not currently available to this account',
        );
      }
    }

    await this.db.$transaction(async tx => {
      await lockTrainingAccount(tx, userId);
      await tx.featuredProfileItem.deleteMany({ where: { userId } });
      if (items.length) {
        await tx.featuredProfileItem.createMany({
          data: items.map(item => ({ userId, ...item })),
        });
      }
    });
    return { items };
  }

  async resolveForProfile(
    userId: string,
    access: Pick<ProfileViewerAccess, 'records' | 'achievements'>,
  ): Promise<FeaturedProfileItem[]> {
    const { items } = await this.list(userId);
    if (!items.length) return [];

    const available = await this.loadAvailable(userId, {
      records: access.records && items.some(item => item.kind === 'RECORD'),
      achievements:
        access.achievements &&
        items.some(item => item.kind === 'ACHIEVEMENT'),
      ranks:
        access.achievements && items.some(item => item.kind === 'RANK'),
    });

    const resolved: FeaturedProfileItem[] = [];
    for (const item of items) {
      if (item.kind === 'RECORD') {
        const record = available.records.get(item.referenceId);
        if (record) resolved.push({ ...item, kind: 'RECORD', record });
        continue;
      }
      if (item.kind === 'ACHIEVEMENT') {
        const achievement = available.achievements.get(item.referenceId);
        if (achievement) {
          resolved.push({ ...item, kind: 'ACHIEVEMENT', achievement });
        }
        continue;
      }
      const rank = available.ranks.get(item.referenceId);
      if (rank) resolved.push({ ...item, kind: 'RANK', rank });
    }
    return resolved;
  }

  private normalize(
    input: FeaturedProfileSelectionInput[],
  ): FeaturedProfileSelection[] {
    if (input.length > FEATURED_PROFILE_ITEMS_MAX) {
      throw new BadRequestException(
        `Choose at most ${FEATURED_PROFILE_ITEMS_MAX} featured items`,
      );
    }
    const seen = new Set<string>();
    let rankCount = 0;
    return input.map((item, position) => {
      const referenceId = item.referenceId.trim();
      if (!referenceId) {
        throw new BadRequestException('Featured item references cannot be blank');
      }
      const key = `${item.kind}:${referenceId}`;
      if (seen.has(key)) {
        throw new BadRequestException('Featured items must be unique');
      }
      seen.add(key);
      if (item.kind === 'RANK' && ++rankCount > 1) {
        throw new BadRequestException('Choose at most one featured rank');
      }
      return { kind: item.kind, referenceId, position };
    });
  }

  private async loadAvailable(
    userId: string,
    requested: { records: boolean; achievements: boolean; ranks: boolean },
  ): Promise<AvailableFeaturedItems> {
    const [recordRows, achievementEvents, projection] = await Promise.all([
      requested.records
        ? this.db.personalRecord.findMany({
            where: { userId },
            select: {
              exerciseId: true,
              exerciseName: true,
              weight: true,
              reps: true,
              estimated1rm: true,
              achievedAt: true,
            },
          })
        : [],
      requested.achievements
        ? this.db.trainingEvent.findMany({
            where: { userId, type: 'ACHIEVEMENT_UNLOCKED' },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            take: ACHIEVEMENT_DEFINITIONS.length,
            select: {
              id: true,
              sessionId: true,
              occurredAt: true,
              payload: true,
            },
          })
        : [],
      requested.ranks
        ? this.db.workoutAnalyticsProjection.findFirst({
            where: { userId, active: true, state: 'READY' },
            select: { id: true, completedSessions: true },
          })
        : null,
    ]);

    const records = new Map<string, PersonalRecordEntry>();
    for (const record of recordRows) {
      records.set(record.exerciseId, {
        ...record,
        achievedAt: record.achievedAt.toISOString(),
      });
    }
    const achievements = new Map(
      achievementEvents.flatMap(event => {
        const achievement = parseAchievementEvent(event);
        return achievement ? [[achievement.id, achievement] as const] : [];
      }),
    );
    const ranks = new Map<string, RenaissanceRankDefinition>();
    if (projection) {
      const activeWeeks = await this.db.workoutRollup.count({
        where: {
          projectionId: projection.id,
          period: 'WEEK',
          sessions: { gt: 0 },
        },
      });
      const current = renaissanceRankProgress(
        projection.completedSessions,
        activeWeeks,
      ).currentRank;
      for (const definition of RENAISSANCE_RANK_DEFINITIONS) {
        ranks.set(definition.id, definition);
        if (definition.id === current.id) break;
      }
    }
    return { records, achievements, ranks };
  }
}
