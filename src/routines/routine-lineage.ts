import type { ProfileVisibility, RoutineLineage, RoutineVisibility, SharedRoutineOwner } from '@sunsteel/contracts';
import { canViewRoutine } from './routine-visibility';

/**
 * ROUT-06. What a clone may say about where it came from.
 *
 * The rule that matters: **lineage never widens what a viewer can learn.** It
 * is resolved through the same `ROUT-04` `canViewRoutine` every other read
 * uses, so a clone of a routine the viewer may not read says it was cloned and
 * stops there. Otherwise a public clone would become a way to discover that a
 * private routine exists, and who wrote it.
 *
 * A source that was deleted, or an author whose account is gone, reaches the
 * same state: the clone still knows it is a clone, and honestly cannot say
 * from what.
 */
export interface LineageSource {
  routineId: string | null;
  clonedAt: Date | null;
  author: (SharedRoutineOwner & { id: string }) | null;
  /** The source routine's own visibility, when it still exists. */
  sourceVisibility: RoutineVisibility | null;
  /** TRUST-04: the source routine's hide, when it still exists. */
  sourceModerationHiddenAt: Date | null;
  /** The author's account-level PROF-06 routines rule. */
  authorRoutinesRule: ProfileVisibility | null;
}

export interface LineageViewer {
  isOwner: boolean;
  isFollower: boolean;
  /** PROF-10: the viewer and the author have blocked each other. */
  isBlocked: boolean;
}

export function resolveRoutineLineage(
  source: LineageSource,
  viewer: LineageViewer,
): RoutineLineage | null {
  // Not a clone at all: the field is absent rather than an empty lineage.
  if (!source.clonedAt) return null;

  const clonedAt = source.clonedAt.toISOString();
  const canSeeSource =
    !viewer.isBlocked &&
    source.routineId !== null &&
    source.author !== null &&
    source.sourceVisibility !== null &&
    source.authorRoutinesRule !== null &&
    canViewRoutine(
      source.authorRoutinesRule,
      source.sourceVisibility,
      { isOwner: viewer.isOwner, isFollower: viewer.isFollower },
      { moderationHiddenAt: source.sourceModerationHiddenAt },
    );

  if (!canSeeSource) {
    return {
      sourceRoutineId: null,
      author: null,
      isSourceHidden: true,
      clonedAt,
    };
  }

  const { id: _id, ...author } = source.author!;
  return {
    sourceRoutineId: source.routineId,
    author,
    isSourceHidden: false,
    clonedAt,
  };
}
