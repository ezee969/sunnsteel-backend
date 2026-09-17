import type { ProfileVisibility, RoutineVisibility } from '@sunsteel/contracts';
import { canViewProfileSection } from '../users/profile-privacy';

/**
 * ROUT-04: whether one routine may be read by one viewer.
 *
 * Two rules apply and the **narrower wins**. The account-level `PROF-06`
 * routines rule is the upper bound, exactly as `SOC-04` bounds an activity by
 * the profile section its data came from; a routine's own visibility can only
 * narrow it. Marking a routine `PUBLIC` inside an account whose routines are
 * `FOLLOWERS` therefore reaches followers, never the world — otherwise a
 * per-routine switch would quietly widen a privacy setting the owner made
 * somewhere else, which is the failure this ordering exists to prevent.
 */
export interface RoutineViewerContext {
  isOwner: boolean;
  isFollower: boolean;
}

export function canViewRoutine(
  accountRoutinesRule: ProfileVisibility,
  routineVisibility: RoutineVisibility,
  context: RoutineViewerContext,
): boolean {
  // The owner always reads their own, whatever either rule says.
  if (context.isOwner) return true;
  // PRIVATE is not a profile visibility value, and it ends the question.
  if (routineVisibility === 'PRIVATE') return false;
  return (
    canViewProfileSection(accountRoutinesRule, context) &&
    canViewProfileSection(routineVisibility, context)
  );
}

/**
 * What the owner is actually granting, for the Settings copy: the narrower of
 * the two rules, so the UI can say "followers" when the account rule caps a
 * routine the owner marked public.
 */
export function effectiveRoutineVisibility(
  accountRoutinesRule: ProfileVisibility,
  routineVisibility: RoutineVisibility,
): RoutineVisibility {
  if (routineVisibility === 'PRIVATE') return 'PRIVATE';
  if (accountRoutinesRule === 'PRIVATE') return 'PRIVATE';
  if (accountRoutinesRule === 'FOLLOWERS') return 'FOLLOWERS';
  return routineVisibility;
}

/** True when the account rule is narrowing what the routine asked for. */
export function isCappedByAccountRule(
  accountRoutinesRule: ProfileVisibility,
  routineVisibility: RoutineVisibility,
): boolean {
  return (
    routineVisibility !== 'PRIVATE' &&
    effectiveRoutineVisibility(accountRoutinesRule, routineVisibility) !==
      routineVisibility
  );
}
