import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  ROUTINE_TRAINING_BLOCK_NAME_MAX,
  type RoutineTrainingBlockState,
} from "@sunsteel/contracts";
import { calendarDateMs } from "../schedule/schedule-overrides";

export function normalizeTrainingBlockName(value: string): string {
  const name = value.trim();
  if (!name) throw new BadRequestException("Name is required");
  if (name.length > ROUTINE_TRAINING_BLOCK_NAME_MAX) {
    throw new BadRequestException(
      `Name must be at most ${ROUTINE_TRAINING_BLOCK_NAME_MAX} characters`,
    );
  }
  return name;
}

export function assertTrainingBlockRange(startDate: string, endDate: string) {
  calendarDateMs(startDate);
  calendarDateMs(endDate);
  if (endDate < startDate) {
    throw new BadRequestException("The block ends before it starts");
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
    throw new ConflictException("Training blocks cannot overlap");
  }
}
