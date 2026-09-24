import { ConflictException } from '@nestjs/common';
import type {
  SessionTemporaryOverride,
  SessionTrainingBlock,
} from '@sunsteel/contracts';

/** The session columns that record the block a session trained (ROUT-15). */
export interface SessionTrainingBlockColumns {
  trainingBlockId: string | null;
  trainingBlockSeriesId: string | null;
  trainingBlockRevision: number | null;
  trainingBlockName: string | null;
}

export function sessionTrainingBlock(
  session: SessionTrainingBlockColumns,
): SessionTrainingBlock | null {
  if (
    !session.trainingBlockId ||
    !session.trainingBlockSeriesId ||
    session.trainingBlockRevision === null ||
    !session.trainingBlockName
  ) {
    return null;
  }
  return {
    id: session.trainingBlockId,
    seriesId: session.trainingBlockSeriesId,
    revision: session.trainingBlockRevision,
    name: session.trainingBlockName,
  };
}

export function trainingBlockColumns(
  block: SessionTrainingBlock | null,
): SessionTrainingBlockColumns {
  return {
    trainingBlockId: block?.id ?? null,
    trainingBlockSeriesId: block?.seriesId ?? null,
    trainingBlockRevision: block?.revision ?? null,
    trainingBlockName: block?.name ?? null,
  };
}

/** ROUT-16: the session columns that record the deload a session trained. */
export interface SessionTemporaryOverrideColumns {
  temporaryOverrideId: string | null;
  temporaryOverrideKind: 'DELOAD' | null;
}

export function sessionTemporaryOverride(
  session: SessionTemporaryOverrideColumns,
): SessionTemporaryOverride | null {
  return session.temporaryOverrideId && session.temporaryOverrideKind
    ? { id: session.temporaryOverrideId, kind: session.temporaryOverrideKind }
    : null;
}

export function temporaryOverrideColumns(
  override: SessionTemporaryOverride | null,
): SessionTemporaryOverrideColumns {
  return {
    temporaryOverrideId: override?.id ?? null,
    temporaryOverrideKind: override?.kind ?? null,
  };
}

/**
 * ROUT-16: a deload is lighter on purpose, so progression never runs for a
 * session that trained one -- at finish or when a correction re-derives it.
 */
export function progressionRuns(session: {
  temporaryOverrideId: string | null;
}) {
  return session.temporaryOverrideId === null;
}

/**
 * ROUT-15: a session trains the plan in force on the owner's local date --
 * the active block's working copy while one is active, the baseline
 * otherwise -- so the schedule, the dashboard and a start can never disagree
 * about which prescription today is. The frontend offers only those days; this
 * is the rule it offers them by, applied again where it counts.
 */
export function assertDayInPlan(
  day: { trainingBlockId: string | null; temporaryOverrideId?: string | null },
  active: { id: string; name: string; endDate: string } | null,
  deload: { id: string; endDate: string } | null = null,
) {
  // ROUT-16: a deload in force owns the date, whatever plan it lightened.
  if (deload) {
    if (day.temporaryOverrideId !== deload.id) {
      throw new ConflictException(
        `This routine is on a deload until ${deload.endDate}; start one of its days`,
      );
    }
    return;
  }
  if (day.temporaryOverrideId) {
    throw new ConflictException(
      'That deload is not in force today; start a day of the plan in force',
    );
  }
  if (active && day.trainingBlockId !== active.id) {
    throw new ConflictException(
      `This routine follows the training block "${active.name}" until ${active.endDate}; start one of its days`,
    );
  }
  if (!active && day.trainingBlockId !== null) {
    throw new ConflictException(
      'That training block is not in force today; start a day of the routine',
    );
  }
}
