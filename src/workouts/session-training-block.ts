import { ConflictException } from '@nestjs/common';
import type { SessionTrainingBlock } from '@sunsteel/contracts';

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

/**
 * ROUT-15: a session trains the plan in force on the owner's local date --
 * the active block's working copy while one is active, the baseline
 * otherwise -- so the schedule, the dashboard and a start can never disagree
 * about which prescription today is. The frontend offers only those days; this
 * is the rule it offers them by, applied again where it counts.
 */
export function assertDayInPlan(
  day: { trainingBlockId: string | null },
  active: { id: string; name: string; endDate: string } | null,
) {
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
