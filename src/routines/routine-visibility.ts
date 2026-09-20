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

/**
 * TRUST-04: the routine's moderation state, passed as its own argument rather
 * than folded into `routineVisibility`, so the owner's own control and a
 * moderator's hide can never be mistaken for each other in the copy that
 * reports either. It is a required field: adding it here is what made the
 * compiler name every read that had to consider it.
 */
export interface RoutineModerationState {
  moderationHiddenAt: Date | null;
}

export function canViewRoutine(
  accountRoutinesRule: ProfileVisibility,
  routineVisibility: RoutineVisibility,
  context: RoutineViewerContext,
  moderation: RoutineModerationState,
): boolean {
  // The owner always reads their own, whatever either rule says. A hide takes
  // the routine away from everyone else; it never takes it from its author.
  if (context.isOwner) return true;
  // TRUST-04: a hidden routine is refused before either rule is asked, so the
  // hide cannot be widened by a later change to one of them.
  if (moderation.moderationHiddenAt) return false;
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
