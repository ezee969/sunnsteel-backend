import {
  ProfilePrivacySettings,
  ProfileViewerAccess,
  ProfileVisibility,
} from '@sunsteel/contracts';

export interface StoredProfilePrivacy {
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
  context: { isOwner: boolean; isFollower: boolean },
): ProfileViewerAccess {
  return {
    workoutHistory: canViewProfileSection(settings.workoutHistory, context),
    records: canViewProfileSection(settings.records, context),
    routines: canViewProfileSection(settings.routines, context),
    achievements: canViewProfileSection(settings.achievements, context),
    bodyMetrics: canViewProfileSection(settings.bodyMetrics, context),
  };
}
