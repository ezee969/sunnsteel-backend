import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  DELOAD_MAX_DAYS,
  deloadLengthDays,
  resolveActiveTrainingBlock,
  apiError,
} from "@sunsteel/contracts";
import {
  addCalendarDays,
  calendarDateMs,
} from "../schedule/schedule-overrides";

/**
 * ROUT-16: the rules a deload's dates must meet, pure so they are tested on
 * their own. A deload is bounded, starts today or later, never overlaps another
 * override of the routine and never crosses a plan boundary: every date it
 * covers must be under the same training block, or under none.
 */
export function assertDeloadDates({
  startDate,
  endDate,
  today,
  overrides,
  blocks,
}: {
  startDate: string;
  endDate: string;
  today: string;
  overrides: readonly { startDate: string; endDate: string }[];
  blocks: readonly { id: string; startDate: string; endDate: string }[];
}): { id: string; startDate: string; endDate: string } | null {
  calendarDateMs(startDate);
  calendarDateMs(endDate);
  if (endDate < startDate) {
    throw new BadRequestException(apiError("DELOAD_ENDS_BEFORE_START"));
  }
  if (startDate < today) {
    throw new BadRequestException(apiError("DELOAD_STARTS_IN_PAST"));
  }
  if (deloadLengthDays(startDate, endDate) > DELOAD_MAX_DAYS) {
    throw new BadRequestException(
      apiError("DELOAD_TOO_LONG", { max: DELOAD_MAX_DAYS }),
    );
  }
  if (
    overrides.some(
      (other) => startDate <= other.endDate && endDate >= other.startDate,
    )
  ) {
    throw new ConflictException(apiError("DELOAD_OVERLAP"));
  }
  const first = resolveActiveTrainingBlock(blocks, startDate);
  for (let date = startDate; date <= endDate; date = addCalendarDays(date, 1)) {
    if (resolveActiveTrainingBlock(blocks, date)?.id !== first?.id) {
      throw new ConflictException(apiError("DELOAD_CROSSES_BLOCK"));
    }
  }
  return first;
}

/** The day a deload ended early leaves it ending on: the day before today. */
export function endedEarlyEndDate(today: string): string {
  return addCalendarDays(today, -1);
}

/**
 * ROUT-16: a training-block write may not change the plan under a deload that
 * has not finished. Overlapping one is refused unless the deload lightened this
 * same block series and still lies wholly inside its new dates.
 */
export function assertBlockLeavesDeloads({
  seriesId,
  startDate,
  endDate,
  today,
  deloads,
}: {
  seriesId: string | null;
  startDate: string;
  endDate: string;
  today: string;
  deloads: readonly {
    startDate: string;
    endDate: string;
    sourceTrainingBlockSeriesId: string | null;
  }[];
}) {
  for (const deload of deloads) {
    if (deload.endDate < today || deload.endDate < deload.startDate) continue;
    const overlaps = startDate <= deload.endDate && endDate >= deload.startDate;
    if (!overlaps) continue;
    const ownAndInside =
      seriesId !== null &&
      deload.sourceTrainingBlockSeriesId === seriesId &&
      startDate <= deload.startDate &&
      deload.endDate <= endDate;
    if (!ownAndInside) {
      throw new ConflictException(apiError("DELOAD_PLANNED_IN_RANGE"));
    }
  }
}
