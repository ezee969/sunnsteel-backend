import {
  isOnboardingStepId,
  ONBOARDING_STEPS_MAX,
  type UpdateOnboardingRequest,
} from "@sunsteel/contracts";

export interface StoredOnboarding {
  onboardingCompletedVersion: number;
  onboardingStepsDone: string[];
  onboardingOfferedAt: Date | null;
}

/**
 * ONBOARD-01: the stored progress after one write. Steps are added to the
 * stored ones (deduplicated, at most ONBOARDING_STEPS_MAX), so two devices
 * never undo each other. A completed version only ever rises, and completing
 * one starts the next run with no steps done -- a lower or equal version
 * leaves both as they are. The first opening is recorded once and kept.
 */
export function nextOnboarding(
  current: StoredOnboarding,
  request: UpdateOnboardingRequest,
  now: Date,
): StoredOnboarding {
  const completes =
    request.completedVersion !== undefined &&
    request.completedVersion > current.onboardingCompletedVersion;
  const steps = completes
    ? []
    : [
        ...new Set([
          ...current.onboardingStepsDone,
          ...(request.stepsDone ?? []).filter(isOnboardingStepId),
        ]),
      ].slice(0, ONBOARDING_STEPS_MAX);
  return {
    onboardingCompletedVersion: completes
      ? request.completedVersion!
      : current.onboardingCompletedVersion,
    onboardingStepsDone: steps,
    onboardingOfferedAt:
      current.onboardingOfferedAt ?? (request.offered ? now : null),
  };
}
