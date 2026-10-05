// Utility
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
// Services
import { DatabaseService } from "../database/database.service";
import { hiddenFromViewer, isHiddenFromViewer } from "./member-blocks";
import { memberSearchBranches } from "./member-search";
import { trainingPartnerPermissions } from "./training-partner-access";
import {
  bodyMeasurementProblems,
  isBodyMeasurementDate,
  type AppLocale,
  isAppLocale,
  isWeekStartsOn,
  DEFAULT_WEEK_STARTS_ON,
  LENGTH_UNITS,
  type UpdateOnboardingRequest,
  type MessagePermission,
  type WeekStartsOn,
  isDefaultDashboardLayout,
  normalizeDashboardLayout,
  type UpdateDashboardLayoutRequest,
  apiError,
} from "@sunsteel/contracts";
import { localDate } from "../notifications/push/local-time";
import { isAllowedEntryDate, isSameWeight } from "./body-measurement-rules";
import { recordProfileWeight } from "./body-weight-sync";
import { nextOnboarding } from "./onboarding";
import { messagingStateFor } from "../messages/messaging-access";
import {
  PREFERRED_TRAINING_STYLE_VALUES,
  ProfileDiscoverySettings,
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_FAVORITE_EXERCISES_MAX,
  PROFILE_LOCATION_MAX_LENGTH,
  PROFILE_TRAINING_DISCIPLINES_MAX,
  PROFILE_TRAINING_GOALS_MAX,
  ProfilePrivacySettings,
  PublicUserProfile,
  TRAINING_DISCIPLINE_VALUES,
  TRAINING_EXPERIENCE_LEVEL_VALUES,
  TRAINING_GOAL_VALUES,
  UpdateProfilePrivacyRequest,
  UpdateProfileDiscoveryRequest,
  UpdateProfileRequest,
  UserProfile,
  UserSearchResponse,
} from "@sunsteel/contracts";
import { Prisma } from "@prisma/client";
import { getUsernameValidationError, normalizeUsername } from "./username";
import {
  mapProfilePrivacy,
  resolveProfileViewerAccess,
} from "./profile-privacy";
import { FeaturedProfileItemsService } from "./featured-profile-items.service";
import { AchievementsService } from "../achievements/achievements.service";

const userProfileSelect = {
  timeZone: true,
  id: true,
  email: true,
  username: true,
  name: true,
  lastName: true,
  avatarUrl: true,
  bio: true,
  location: true,
  trainingGoals: true,
  trainingExperienceLevel: true,
  trainingDisciplines: true,
  preferredTrainingStyle: true,
  age: true,
  sex: true,
  weight: true,
  height: true,
  weightUnit: true,
  bioVisibility: true,
  locationVisibility: true,
  trainingIdentityVisibility: true,
  historyVisibility: true,
  recordsVisibility: true,
  routinesVisibility: true,
  achievementsVisibility: true,
  bodyMetricsVisibility: true,
  bodyProgressVisibility: true,
  rankVisibility: true,
  discoverableByName: true,
  discoverableByUsername: true,
  discoverableByContacts: true,
  // TRUST-04: the owner's own read only. It never reaches PublicUserProfile.
  isModerator: true,
  dashboardLayout: true,
  locale: true,
  // PREF-04
  weekStartsOn: true,
  lengthUnit: true,
  // ONBOARD-01
  onboardingCompletedVersion: true,
  onboardingStepsDone: true,
  onboardingOfferedAt: true,
  // MSG-01
  messagePermission: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      followers: true,
      following: true,
    },
  },
  favoriteExercises: {
    orderBy: { position: "asc" as const },
    select: {
      exercise: {
        select: { id: true, name: true },
      },
    },
  },
} as const;

type UserProfileRecord = Prisma.UserGetPayload<{
  select: typeof userProfileSelect;
}>;

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly featuredProfileItems?: FeaturedProfileItemsService,
    private readonly achievementsService?: AchievementsService,
  ) {}

  /**
   * PROF-10 blocks and TRUST-04 hides, answered together by the shared helper
   * so a read cannot honour one and omit the other. It is deliberately not an
   * injected service: a privacy control must not be able to fail open because
   * of how the module was wired.
   */
  private async hiddenMemberIds(viewerId: string): Promise<string[]> {
    return hiddenFromViewer(this.db, viewerId);
  }

  // Serialization boundary: Prisma record -> `UserProfile` contract
  // (folds follow counts, converts Date -> ISO string).
  private mapUserProfile(user: UserProfileRecord): UserProfile {
    const {
      _count,
      createdAt,
      updatedAt,
      bioVisibility,
      locationVisibility,
      trainingIdentityVisibility,
      trainingGoals,
      trainingExperienceLevel,
      trainingDisciplines,
      preferredTrainingStyle,
      favoriteExercises,
      historyVisibility,
      recordsVisibility,
      routinesVisibility,
      achievementsVisibility,
      bodyMetricsVisibility,
      bodyProgressVisibility,
      rankVisibility,
      discoverableByName,
      discoverableByUsername,
      discoverableByContacts,
      isModerator,
      dashboardLayout,
      locale,
      weekStartsOn,
      onboardingCompletedVersion,
      onboardingStepsDone,
      onboardingOfferedAt,
      ...profile
    } = user;
    return {
      ...profile,
      privacySettings: mapProfilePrivacy({
        bioVisibility,
        locationVisibility,
        trainingIdentityVisibility,
        historyVisibility,
        recordsVisibility,
        routinesVisibility,
        achievementsVisibility,
        bodyMetricsVisibility,
        bodyProgressVisibility,
        rankVisibility,
      }),
      discoverySettings: {
        discoverableByName,
        discoverableByUsername,
        discoverableByContacts,
      },
      isModerator,
      dashboardLayout: normalizeDashboardLayout(dashboardLayout),
      locale: isAppLocale(locale) ? locale : null,
      weekStartsOn: isWeekStartsOn(weekStartsOn)
        ? weekStartsOn
        : DEFAULT_WEEK_STARTS_ON,
      onboarding: {
        completedVersion: onboardingCompletedVersion,
        stepsDone: onboardingStepsDone,
        offeredAt: onboardingOfferedAt?.toISOString() ?? null,
      },
      trainingIdentity: {
        goals: trainingGoals,
        experienceLevel: trainingExperienceLevel,
        disciplines: trainingDisciplines,
        preferredStyle: preferredTrainingStyle,
        favoriteExercises: favoriteExercises.map(({ exercise }) => exercise),
      },
      followerCount: _count.followers,
      followingCount: _count.following,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const user = await this.db.user.findUnique({
      where: { email },
      select: userProfileSelect,
    });
    if (!user) return null;
    return this.mapUserProfile(user);
  }

  async updateProfile(
    email: string,
    data: UpdateProfileRequest,
  ): Promise<UserProfile> {
    const username =
      data.username === undefined
        ? undefined
        : this.validateUsername(data.username);
    const bio = this.normalizeProfileText(
      data.bio,
      PROFILE_BIO_MAX_LENGTH,
      "Biography",
    );
    const location = this.normalizeProfileText(
      data.location,
      PROFILE_LOCATION_MAX_LENGTH,
      "Location",
    );
    // PREF-04: the body is a contracts interface, so nothing upstream checks
    // the enum; an unknown unit is refused here rather than by the database.
    if (
      data.lengthUnit !== undefined &&
      !(LENGTH_UNITS as readonly string[]).includes(data.lengthUnit)
    ) {
      throw new BadRequestException("Unknown length unit");
    }
    const trainingGoals = this.validateSelection(
      data.trainingGoals,
      TRAINING_GOAL_VALUES,
      PROFILE_TRAINING_GOALS_MAX,
      "Training goals",
    );
    const trainingExperienceLevel = this.validateOptionalChoice(
      data.trainingExperienceLevel,
      TRAINING_EXPERIENCE_LEVEL_VALUES,
      "Training experience level",
    );
    const trainingDisciplines = this.validateSelection(
      data.trainingDisciplines,
      TRAINING_DISCIPLINE_VALUES,
      PROFILE_TRAINING_DISCIPLINES_MAX,
      "Training disciplines",
    );
    const preferredTrainingStyle = this.validateOptionalChoice(
      data.preferredTrainingStyle,
      PREFERRED_TRAINING_STYLE_VALUES,
      "Preferred training style",
    );
    const favoriteExerciseIds = await this.validateFavoriteExerciseIds(
      data.favoriteExerciseIds,
    );
    // PROG-12: a changed weight is also recorded as that date's measurement.
    const before =
      typeof data.weight === "number"
        ? await this.db.user.findUnique({
            where: { email },
            select: { id: true, weight: true, timeZone: true },
          })
        : null;

    try {
      const user = await this.db.user.update({
        where: { email },
        data: {
          username,
          name: data.name,
          lastName: data.lastName,
          avatarUrl: data.avatarUrl,
          bio,
          location,
          trainingGoals,
          trainingExperienceLevel,
          trainingDisciplines,
          preferredTrainingStyle,
          favoriteExercises:
            favoriteExerciseIds === undefined
              ? undefined
              : {
                  deleteMany: {},
                  create: favoriteExerciseIds.map((exerciseId, position) => ({
                    position,
                    exercise: { connect: { id: exerciseId } },
                  })),
                },
          age: data.age,
          sex: data.sex,
          weight: data.weight,
          height: data.height,
          weightUnit: data.weightUnit,
          lengthUnit: data.lengthUnit,
        },
        select: userProfileSelect,
      });
      if (
        before &&
        typeof data.weight === "number" &&
        !isSameWeight(before.weight, data.weight) &&
        bodyMeasurementProblems({ weightKg: data.weight }).length === 0
      ) {
        const current = await recordProfileWeight(
          this.db,
          before.id,
          this.measurementDate(data.localDate, before.timeZone),
          data.weight,
        );
        if (current !== null) user.weight = current;
      }
      return this.mapUserProfile(user);
    } catch (error) {
      if (this.isUniqueUsernameViolation(error)) {
        throw new ConflictException(apiError("USERNAME_TAKEN"));
      }
      throw error;
    }
  }

  /** The member's own local date when it is a real one not in the future, else the server's. */
  private measurementDate(
    requested: string | undefined,
    timeZone: string | null,
  ): string {
    const today = localDate(new Date(), timeZone ?? "UTC");
    return requested &&
      isBodyMeasurementDate(requested) &&
      isAllowedEntryDate(requested, today)
      ? requested
      : today;
  }

  /**
   * DASH-05 / PREF-03: the dashboard order and hidden sections. What is stored
   * is the normalized layout, or null when it is the default, so a member who
   * never changed it follows the default as sections are added.
   */
  async updateDashboardLayout(
    email: string,
    sections: UpdateDashboardLayoutRequest["sections"],
  ): Promise<UserProfile> {
    const layout = normalizeDashboardLayout(sections);
    const user = await this.db.user.update({
      where: { email },
      data: {
        dashboardLayout: isDefaultDashboardLayout(layout)
          ? Prisma.DbNull
          : (layout as unknown as Prisma.InputJsonValue),
      },
      select: userProfileSelect,
    });
    return this.mapUserProfile(user);
  }

  /**
   * I18N-02: the account's language, or null to follow each device. The
   * frontend mirrors it into its locale cookie; push notifications are
   * written in it (I18N-06).
   */
  async updateLocale(
    email: string,
    locale: AppLocale | null,
  ): Promise<UserProfile> {
    const user = await this.db.user.update({
      where: { email },
      data: { locale },
      select: userProfileSelect,
    });
    return this.mapUserProfile(user);
  }

  /**
   * PREF-04: the weekday the account's weeks start on. Every weekly view reads
   * it; the rank does not, so changing it never moves a rank.
   */
  /** MSG-01: who may start a conversation with this member. */
  async updateMessagePermission(
    email: string,
    messagePermission: MessagePermission,
  ): Promise<UserProfile> {
    const user = await this.db.user.update({
      where: { email },
      data: { messagePermission },
      select: userProfileSelect,
    });
    return this.mapUserProfile(user);
  }

  async updateWeekStart(
    email: string,
    weekStartsOn: WeekStartsOn,
  ): Promise<UserProfile> {
    const user = await this.db.user.update({
      where: { email },
      data: { weekStartsOn },
      select: userProfileSelect,
    });
    return this.mapUserProfile(user);
  }

  /**
   * ONBOARD-01: progress through onboarding. Steps are added to what is
   * stored, so two devices never undo each other; a completed version only
   * rises and starts the next run empty; the first opening is kept.
   */
  async updateOnboarding(
    email: string,
    request: UpdateOnboardingRequest,
  ): Promise<UserProfile> {
    return this.db.$transaction(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({
        where: { email },
        select: {
          onboardingCompletedVersion: true,
          onboardingStepsDone: true,
          onboardingOfferedAt: true,
        },
      });
      const next = nextOnboarding(current, request, new Date());
      const user = await tx.user.update({
        where: { email },
        data: next,
        select: userProfileSelect,
      });
      return this.mapUserProfile(user);
    });
  }

  async updateProfilePrivacy(
    email: string,
    data: UpdateProfilePrivacyRequest,
  ): Promise<UserProfile> {
    const user = await this.db.user.update({
      where: { email },
      data: {
        ...(data.biography === undefined
          ? {}
          : { bioVisibility: data.biography }),
        ...(data.location === undefined
          ? {}
          : { locationVisibility: data.location }),
        ...(data.trainingIdentity === undefined
          ? {}
          : { trainingIdentityVisibility: data.trainingIdentity }),
        historyVisibility: data.workoutHistory,
        recordsVisibility: data.records,
        routinesVisibility: data.routines,
        achievementsVisibility: data.achievements,
        bodyMetricsVisibility: data.bodyMetrics,
        ...(data.bodyProgress === undefined
          ? {}
          : { bodyProgressVisibility: data.bodyProgress }),
        ...(data.rank === undefined ? {} : { rankVisibility: data.rank }),
      },
      select: userProfileSelect,
    });
    return this.mapUserProfile(user);
  }

  async updateProfileDiscovery(
    email: string,
    data: UpdateProfileDiscoveryRequest,
  ): Promise<UserProfile> {
    const discoverySettings: ProfileDiscoverySettings = data;
    const user = await this.db.user.update({
      where: { email },
      data: discoverySettings,
      select: userProfileSelect,
    });
    return this.mapUserProfile(user);
  }

  async searchUsers(
    query: string,
    excludeUserId: string,
    limit: number = 10,
  ): Promise<UserSearchResponse[]> {
    const searches = memberSearchBranches(query ?? "");
    if (!searches) return [];

    // PROF-10: neither party of a block appears in the other's search.
    const hidden = await this.hiddenMemberIds(excludeUserId);
    return this.db.user.findMany({
      where: {
        id: { not: excludeUserId, notIn: hidden },
        OR: searches,
      },
      select: {
        id: true,
        username: true,
        name: true,
        lastName: true,
        avatarUrl: true,
      },
      take: limit,
      orderBy: [{ username: "asc" }, { name: "asc" }],
    });
  }

  async getPublicProfile(
    viewerUserId: string | null,
    targetIdentifier: string,
  ): Promise<PublicUserProfile> {
    const user = await this.db.user.findFirst({
      where: {
        OR: [
          { id: targetIdentifier },
          { username: normalizeUsername(targetIdentifier) },
        ],
      },
      select: {
        id: true,
        username: true,
        name: true,
        lastName: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        bioVisibility: true,
        locationVisibility: true,
        trainingIdentityVisibility: true,
        historyVisibility: true,
        recordsVisibility: true,
        routinesVisibility: true,
        achievementsVisibility: true,
        bodyMetricsVisibility: true,
        bodyProgressVisibility: true,
        rankVisibility: true,
        moderationHiddenAt: true,
        messagePermission: true,
        _count: {
          select: {
            followers: true,
            following: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(apiError("USER_NOT_FOUND"));
    }

    const isOwner = viewerUserId === user.id;
    // TRUST-04: a hidden account answers 404 to everyone but itself, and it is
    // checked before the block and before any sensitive read -- including on
    // the unguarded route, which has no viewer to compare against. The owner
    // keeps their own profile intact; the hide removes it from others.
    if (user.moderationHiddenAt && !isOwner) {
      throw new NotFoundException(apiError("USER_NOT_FOUND"));
    }
    // PROF-10: a blocked profile answers 404 in both directions, exactly as a
    // denied routine does under ROUT-04. A 403 would confirm the account
    // exists and that a block is the reason.
    const blocked =
      viewerUserId && !isOwner
        ? await isHiddenFromViewer(this.db, viewerUserId, user.id)
        : false;
    if (blocked) throw new NotFoundException(apiError("USER_NOT_FOUND"));
    const partnerPermissions = await trainingPartnerPermissions(
      this.db,
      viewerUserId,
      user.id,
    );
    const viewerBlocksTarget =
      viewerUserId && !isOwner
        ? (await this.db.userBlock.count({
            where: { blockerId: viewerUserId, blockedId: user.id },
          })) > 0
        : false;
    const followRelation =
      !viewerUserId || isOwner
        ? null
        : await this.db.userFollow.findUnique({
            where: {
              followerId_followingId: {
                followerId: viewerUserId,
                followingId: user.id,
              },
            },
            select: { followerId: true },
          });
    const isFollower = !!followRelation;
    const privacySettings: ProfilePrivacySettings = mapProfilePrivacy(user);
    const viewerAccess = resolveProfileViewerAccess(privacySettings, {
      isOwner,
      isFollower,
      partnerProgress: partnerPermissions.progress,
      partnerRoutines: partnerPermissions.routines,
    });

    // MSG-01: only on the authenticated read, after the 404s above.
    const messaging =
      viewerUserId && !isOwner
        ? await messagingStateFor(this.db, viewerUserId, user)
        : null;

    const [
      projection,
      personalRecords,
      bodyMetrics,
      biography,
      location,
      trainingIdentity,
      featuredItems,
      ledger,
      rank,
    ] = await Promise.all([
      viewerAccess.workoutHistory
        ? this.db.workoutAnalyticsProjection.findFirst({
            where: { userId: user.id, active: true, state: "READY" },
            select: {
              completedSessions: true,
              totalVolumeKg: true,
              currentRun: true,
              bestRun: true,
            },
          })
        : null,
      viewerAccess.records
        ? this.db.personalRecord.findMany({
            where: { userId: user.id },
            orderBy: [{ achievedAt: "desc" }, { id: "desc" }],
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
      viewerAccess.bodyMetrics
        ? this.db.user.findUnique({
            where: { id: user.id },
            select: { age: true, sex: true, weight: true, height: true },
          })
        : null,
      viewerAccess.biography
        ? this.db.user.findUnique({
            where: { id: user.id },
            select: { bio: true },
          })
        : null,
      viewerAccess.location
        ? this.db.user.findUnique({
            where: { id: user.id },
            select: { location: true },
          })
        : null,
      viewerAccess.trainingIdentity
        ? this.db.user.findUnique({
            where: { id: user.id },
            select: {
              trainingGoals: true,
              trainingExperienceLevel: true,
              trainingDisciplines: true,
              preferredTrainingStyle: true,
              favoriteExercises: {
                orderBy: [{ position: "asc" }, { exerciseId: "asc" }],
                select: {
                  exercise: { select: { id: true, name: true } },
                },
              },
            },
          })
        : null,
      this.featuredProfileItems?.resolveForProfile(user.id, viewerAccess, {
        isOwner,
        isFollower: isFollower || partnerPermissions.routines,
      }) ?? [],
      viewerAccess.achievements && this.achievementsService
        ? this.achievementsService.forProfile(user.id)
        : null,
      // ACH-10: the rank has its own rule, read without the ledger.
      viewerAccess.rank && this.achievementsService
        ? this.achievementsService.rankForProfile(user.id)
        : null,
    ]);
    // The ledger names the rank too, so it carries one only where the rank
    // rule allows: hiding the rank must not leave it readable there.
    const achievements = ledger
      ? { ...ledger, rank: viewerAccess.rank ? ledger.rank : null }
      : null;

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      followerCount: user._count.followers,
      followingCount: user._count.following,
      isFollowedByMe: isFollower,
      ...(viewerUserId && !isOwner
        ? { moderation: { isBlocked: viewerBlocksTarget } }
        : {}),
      ...(messaging ? { messaging } : {}),
      viewerAccess,
      featuredItems,
      ...(viewerAccess.biography ? { bio: biography?.bio ?? null } : {}),
      ...(viewerAccess.location
        ? { location: location?.location ?? null }
        : {}),
      ...(viewerAccess.trainingIdentity
        ? {
            trainingIdentity: {
              goals: trainingIdentity?.trainingGoals ?? [],
              experienceLevel:
                trainingIdentity?.trainingExperienceLevel ?? null,
              disciplines: trainingIdentity?.trainingDisciplines ?? [],
              preferredStyle: trainingIdentity?.preferredTrainingStyle ?? null,
              favoriteExercises:
                trainingIdentity?.favoriteExercises.map(
                  ({ exercise }) => exercise,
                ) ?? [],
            },
          }
        : {}),
      ...(viewerAccess.workoutHistory
        ? {
            trainingSummary: {
              completedWorkouts: projection?.completedSessions ?? 0,
              totalVolumeKg: projection?.totalVolumeKg ?? 0,
              currentStreakDays: projection?.currentRun ?? 0,
              bestStreakDays: projection?.bestRun ?? 0,
            },
          }
        : {}),
      ...(viewerAccess.records
        ? {
            personalRecords: personalRecords.map((record) => ({
              ...record,
              achievedAt: record.achievedAt.toISOString(),
            })),
          }
        : {}),
      ...(viewerAccess.achievements && achievements ? { achievements } : {}),
      ...(viewerAccess.rank ? { rank } : {}),
      ...(viewerAccess.bodyMetrics
        ? {
            bodyMetrics: {
              age: bodyMetrics?.age ?? null,
              sex: bodyMetrics?.sex ?? null,
              weightKg: bodyMetrics?.weight ?? null,
              heightCm: bodyMetrics?.height ?? null,
            },
          }
        : {}),
    };
  }

  async followUser(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<PublicUserProfile> {
    if (viewerUserId === targetUserId) {
      throw new BadRequestException(apiError("FOLLOW_SELF"));
    }

    const targetUser = await this.db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!targetUser) {
      throw new NotFoundException(apiError("USER_NOT_FOUND"));
    }
    // A block prevents a follow in both directions, and a TRUST-04 hide
    // prevents one in the same way; the refusal is the same 404 the profile
    // gives, so it cannot be used to detect either.
    if (await isHiddenFromViewer(this.db, viewerUserId, targetUserId)) {
      throw new NotFoundException(apiError("USER_NOT_FOUND"));
    }

    try {
      await this.db.userFollow.create({
        data: {
          followerId: viewerUserId,
          followingId: targetUserId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code !== "P2002"
      ) {
        throw error;
      }
    }

    return this.getPublicProfile(viewerUserId, targetUserId);
  }

  async unfollowUser(
    viewerUserId: string,
    targetUserId: string,
  ): Promise<PublicUserProfile> {
    if (viewerUserId === targetUserId) {
      throw new BadRequestException(apiError("UNFOLLOW_SELF"));
    }

    const targetUser = await this.db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!targetUser) {
      throw new NotFoundException(apiError("USER_NOT_FOUND"));
    }

    await this.db.userFollow.deleteMany({
      where: {
        followerId: viewerUserId,
        followingId: targetUserId,
      },
    });

    return this.getPublicProfile(viewerUserId, targetUserId);
  }

  private validateUsername(value: string): string {
    const username = normalizeUsername(value);
    const error = getUsernameValidationError(username);
    if (error === "RESERVED") {
      throw new BadRequestException(apiError("USERNAME_RESERVED"));
    }
    if (error === "INVALID_FORMAT") {
      throw new BadRequestException(apiError("USERNAME_INVALID"));
    }
    return username;
  }

  private normalizeProfileText(
    value: string | null | undefined,
    maxLength: number,
    label: string,
  ): string | null | undefined {
    if (value === undefined || value === null) return value;
    const normalized = value.trim();
    if (normalized.length > maxLength) {
      throw new BadRequestException(
        `${label} must be ${maxLength} characters or fewer`,
      );
    }
    return normalized || null;
  }

  private validateSelection<T extends string>(
    value: T[] | undefined,
    allowed: readonly T[],
    maxItems: number,
    label: string,
  ): T[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${label} must be an array`);
    }
    const unique = [...new Set(value)];
    if (unique.length !== value.length) {
      throw new BadRequestException(`${label} cannot contain duplicates`);
    }
    if (unique.length > maxItems) {
      throw new BadRequestException(
        `${label} can contain at most ${maxItems} selections`,
      );
    }
    if (unique.some((item) => !allowed.includes(item))) {
      throw new BadRequestException(`${label} contains an invalid selection`);
    }
    return unique;
  }

  private validateOptionalChoice<T extends string>(
    value: T | null | undefined,
    allowed: readonly T[],
    label: string,
  ): T | null | undefined {
    if (value === undefined || value === null) return value;
    if (!allowed.includes(value)) {
      throw new BadRequestException(`${label} is invalid`);
    }
    return value;
  }

  private async validateFavoriteExerciseIds(
    value: string[] | undefined,
  ): Promise<string[] | undefined> {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      throw new BadRequestException("Favorite exercises must be an array");
    }
    if (value.some((id) => typeof id !== "string" || !id.trim())) {
      throw new BadRequestException(
        "Favorite exercises contains an invalid selection",
      );
    }
    const ids = [...new Set(value)];
    if (ids.length !== value.length) {
      throw new BadRequestException(
        "Favorite exercises cannot contain duplicates",
      );
    }
    if (ids.length > PROFILE_FAVORITE_EXERCISES_MAX) {
      throw new BadRequestException(
        `Favorite exercises can contain at most ${PROFILE_FAVORITE_EXERCISES_MAX} selections`,
      );
    }
    if (ids.length === 0) return ids;
    // EXER-06: favorites are public training identity, so catalog only.
    const existing = await this.db.exercise.findMany({
      where: { id: { in: ids }, ownerId: null },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException(
        "One or more favorite exercises do not exist",
      );
    }
    return ids;
  }

  private isUniqueUsernameViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      (Array.isArray(error.meta?.target)
        ? error.meta.target.includes("username")
        : String(error.meta?.target).includes("username"))
    );
  }
}
