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
  ProfileVisibility,
  RENAISSANCE_RANK_DEFINITIONS,
  RenaissanceRankDefinition,
  RoutineVisibility,
  SharedRoutineSummary,
} from '@sunsteel/contracts';
import { parseAchievementEvent } from '../achievements/achievements.service';
import { renaissanceRankProgress } from '../achievements/renaissance-ranks';
import { DatabaseService } from '../database/database.service';
import {
  ROUTINE_SUMMARY_SELECT,
  toSharedRoutineSummary,
} from '../routines/routine-summary';
import {
  canViewRoutine,
  effectiveRoutineVisibility,
} from '../routines/routine-visibility';
import { lockTrainingAccount } from '../workouts/analytics/analytics-lock';

interface AvailableFeaturedItems {
  records: Map<string, PersonalRecordEntry>;
  achievements: Map<
    string,
    Extract<FeaturedProfileItem, { kind: 'ACHIEVEMENT' }>['achievement']
  >;
  ranks: Map<string, RenaissanceRankDefinition>;
  routines: Map<string, SharedRoutineSummary>;
}

/**
 * PROF-08: who a routine slot is being resolved for. The owner choosing in
 * Settings and a visitor reading the profile ask different questions of the
 * same routine, so the caller says which.
 */
export type FeaturedRoutineAudience =
  | { kind: 'OWNER_SELECTING' }
  | { kind: 'VIEWER'; isOwner: boolean; isFollower: boolean };

/**
 * `ROUT-04`'s rule, asked the way each caller needs it. Selecting, the owner
 * may only feature a routine that somebody else could actually reach, so a
 * routine the account rule caps to `PRIVATE` is not offered. Reading, the
 * viewer gets exactly what `canViewRoutine` allows — the account-level
 * `PROF-06` routines rule capping the routine's own visibility, narrower
 * first, as everywhere else.
 */
function isRoutineFeaturable(
  accountRule: ProfileVisibility,
  visibility: RoutineVisibility,
  audience: FeaturedRoutineAudience,
  moderation: { moderationHiddenAt: Date | null },
): boolean {
  // TRUST-04: a hidden routine is offered to nobody, its owner included --
  // featuring it would put a slot on the profile that no viewer renders.
  if (moderation.moderationHiddenAt) return false;
  return audience.kind === 'OWNER_SELECTING'
    ? effectiveRoutineVisibility(accountRule, visibility) !== 'PRIVATE'
    : canViewRoutine(accountRule, visibility, audience, moderation);
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
    const available = await this.loadAvailable(
      userId,
      {
        records: items.some(item => item.kind === 'RECORD'),
        achievements: items.some(item => item.kind === 'ACHIEVEMENT'),
        ranks: items.some(item => item.kind === 'RANK'),
        routines: items.some(item => item.kind === 'ROUTINE'),
      },
      { kind: 'OWNER_SELECTING' },
    );
    for (const item of items) {
      if (!this.hasAvailable(available, item)) {
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

  /**
   * PROF-08 adds the viewer context: a routine slot cannot be answered by a
   * profile-section flag alone, because each routine also carries its own
   * `ROUT-04` visibility. `canViewRoutine` applies both and takes the narrower,
   * so nothing here re-implements the rule.
   */
  async resolveForProfile(
    userId: string,
    access: Pick<ProfileViewerAccess, 'records' | 'achievements'>,
    viewer: { isOwner: boolean; isFollower: boolean },
  ): Promise<FeaturedProfileItem[]> {
    const { items } = await this.list(userId);
    if (!items.length) return [];

    const available = await this.loadAvailable(
      userId,
      {
        records: access.records && items.some(item => item.kind === 'RECORD'),
        achievements:
          access.achievements &&
          items.some(item => item.kind === 'ACHIEVEMENT'),
        ranks:
          access.achievements && items.some(item => item.kind === 'RANK'),
        routines: items.some(item => item.kind === 'ROUTINE'),
      },
      { kind: 'VIEWER', ...viewer },
    );

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
      if (item.kind === 'ROUTINE') {
        const routine = available.routines.get(item.referenceId);
        if (routine) resolved.push({ ...item, kind: 'ROUTINE', routine });
        continue;
      }
      const rank = available.ranks.get(item.referenceId);
      if (rank) resolved.push({ ...item, kind: 'RANK', rank });
    }
    return resolved;
  }

  private hasAvailable(
    available: AvailableFeaturedItems,
    item: FeaturedProfileSelection,
  ): boolean {
    if (item.kind === 'RECORD') return available.records.has(item.referenceId);
    if (item.kind === 'ACHIEVEMENT') {
      return available.achievements.has(item.referenceId);
    }
    if (item.kind === 'ROUTINE') {
      return available.routines.has(item.referenceId);
    }
    return available.ranks.has(item.referenceId);
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
    requested: {
      records: boolean;
      achievements: boolean;
      ranks: boolean;
      routines: boolean;
    },
    audience: FeaturedRoutineAudience,
  ): Promise<AvailableFeaturedItems> {
    const [recordRows, achievementEvents, projection, routines] =
      await Promise.all([
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
      requested.routines
        ? this.loadRoutines(userId, audience)
        : new Map<string, SharedRoutineSummary>(),
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
    return { records, achievements, ranks, routines };
  }

  /**
   * The owner's routines that this audience may be shown, keyed by routine id.
   * They are read through the same summary select and mapper the `ROUT-04`
   * member list uses, so a featured routine and a listed one can never present
   * the same routine differently.
   */
  private async loadRoutines(
    userId: string,
    audience: FeaturedRoutineAudience,
  ): Promise<Map<string, SharedRoutineSummary>> {
    const owner = await this.db.user.findUnique({
      where: { id: userId },
      select: { routinesVisibility: true },
    });
    if (!owner) return new Map();

    const rows = await this.db.routine.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: ROUTINE_SUMMARY_SELECT,
    });
    return new Map(
      rows
        .filter(routine =>
          isRoutineFeaturable(
            owner.routinesVisibility,
            routine.visibility,
            audience,
            routine,
          ),
        )
        .map(routine => [routine.id, toSharedRoutineSummary(routine)] as const),
    );
  }
}
