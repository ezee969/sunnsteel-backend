import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  ROUTINE_TRAINING_BLOCK_NAME_MAX,
  type RoutineTrainingBlockState,
  apiError,
} from "@sunsteel/contracts";
import { calendarDateMs } from "../schedule/schedule-overrides";

export function normalizeTrainingBlockName(value: string): string {
  const name = value.trim();
  if (!name)
    throw new BadRequestException(apiError("TRAINING_BLOCK_NAME_REQUIRED"));
  if (name.length > ROUTINE_TRAINING_BLOCK_NAME_MAX) {
    throw new BadRequestException(
      apiError("TRAINING_BLOCK_NAME_TOO_LONG", {
        max: ROUTINE_TRAINING_BLOCK_NAME_MAX,
      }),
    );
  }
  return name;
}

export function assertTrainingBlockRange(startDate: string, endDate: string) {
  calendarDateMs(startDate);
  calendarDateMs(endDate);
  if (endDate < startDate) {
    throw new BadRequestException(apiError("TRAINING_BLOCK_ENDS_BEFORE_START"));
  }
}

export function trainingBlockState(
  startDate: string,
  endDate: string,
  today: string,
): RoutineTrainingBlockState {
  if (today < startDate) return "FUTURE";
  if (today > endDate) return "COMPLETE";
  return "ACTIVE";
}

export function assertNoTrainingBlockOverlap(
  startDate: string,
  endDate: string,
  blocks: readonly { startDate: string; endDate: string }[],
) {
  if (
    blocks.some(
      (block) => startDate <= block.endDate && endDate >= block.startDate,
    )
  ) {
    throw new ConflictException(apiError("TRAINING_BLOCK_OVERLAP"));
  }
}
