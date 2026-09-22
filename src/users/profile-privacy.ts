import {
  ProfilePrivacySettings,
  ProfileViewerAccess,
  ProfileVisibility,
} from '@sunsteel/contracts';

export interface StoredProfilePrivacy {
  bioVisibility: ProfileVisibility;
  locationVisibility: ProfileVisibility;
  trainingIdentityVisibility: ProfileVisibility;
  historyVisibility: ProfileVisibility;
  recordsVisibility: ProfileVisibility;
  routinesVisibility: ProfileVisibility;
  achievementsVisibility: ProfileVisibility;
  bodyMetricsVisibility: ProfileVisibility;
}

export function mapProfilePrivacy(
  stored: StoredProfilePrivacy,
): ProfilePrivacySettings {
  return {
    biography: stored.bioVisibility,
    location: stored.locationVisibility,
    trainingIdentity: stored.trainingIdentityVisibility,
    workoutHistory: stored.historyVisibility,
    records: stored.recordsVisibility,
    routines: stored.routinesVisibility,
    achievements: stored.achievementsVisibility,
    bodyMetrics: stored.bodyMetricsVisibility,
  };
}

export function canViewProfileSection(
  visibility: ProfileVisibility,
  context: { isOwner: boolean; isFollower: boolean },
): boolean {
  if (context.isOwner) return true;
  if (visibility === 'PUBLIC') return true;
  return visibility === 'FOLLOWERS' && context.isFollower;
}

export function resolveProfileViewerAccess(
  settings: ProfilePrivacySettings,
  context: {
    isOwner: boolean;
    isFollower: boolean;
    partnerProgress?: boolean;
    partnerRoutines?: boolean;
  },
): ProfileViewerAccess {
  const progressContext = {
    isOwner: context.isOwner,
    isFollower: context.isFollower || context.partnerProgress === true,
  };
  const routinesContext = {
    isOwner: context.isOwner,
    isFollower: context.isFollower || context.partnerRoutines === true,
  };
  return {
    biography: canViewProfileSection(settings.biography, context),
    location: canViewProfileSection(settings.location, context),
    trainingIdentity: canViewProfileSection(
      settings.trainingIdentity,
      context,
    ),
    workoutHistory: canViewProfileSection(
      settings.workoutHistory,
      progressContext,
    ),
    records: canViewProfileSection(settings.records, progressContext),
    routines: canViewProfileSection(settings.routines, routinesContext),
    achievements: canViewProfileSection(
      settings.achievements,
      progressContext,
    ),
    bodyMetrics: canViewProfileSection(settings.bodyMetrics, context),
  };
}
