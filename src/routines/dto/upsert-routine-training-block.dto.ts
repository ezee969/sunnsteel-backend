import { IsOptional, IsString, Matches, MaxLength } from "class-validator";
import {
  ROUTINE_TRAINING_BLOCK_NAME_MAX,
  type UpsertRoutineTrainingBlockRequest,
} from "@sunsteel/contracts";

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = "$property must be a YYYY-MM-DD date";

export class UpsertRoutineTrainingBlockDto implements UpsertRoutineTrainingBlockRequest {
  @IsString()
  @MaxLength(ROUTINE_TRAINING_BLOCK_NAME_MAX + 20)
  name: string;

  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  startDate: string;

  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  endDate: string;

  @IsOptional()
  @IsString()
  sourceVersionId?: string | null;
}
