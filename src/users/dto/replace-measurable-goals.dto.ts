import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsUUID,
  ValidateNested,
} from "class-validator";
import type {
  MeasurableGoalDirection,
  MeasurableGoalInput,
  MeasurableGoalType,
  ReplaceMeasurableGoalsRequest,
} from "@sunsteel/contracts";
import {
  MEASURABLE_GOAL_DIRECTIONS,
  MEASURABLE_GOAL_TYPES,
  MEASURABLE_GOALS_MAX,
} from "@sunsteel/contracts";

export class MeasurableGoalInputDto implements MeasurableGoalInput {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsIn(MEASURABLE_GOAL_TYPES)
  type!: MeasurableGoalType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  targetValue!: number;

  @IsOptional()
  @IsIn(MEASURABLE_GOAL_DIRECTIONS)
  direction?: MeasurableGoalDirection;

  @IsOptional()
  @IsUUID()
  exerciseId?: string;
}

export class ReplaceMeasurableGoalsDto implements ReplaceMeasurableGoalsRequest {
  @IsArray()
  @ArrayMaxSize(MEASURABLE_GOALS_MAX)
  @ValidateNested({ each: true })
  @Type(() => MeasurableGoalInputDto)
  goals!: MeasurableGoalInputDto[];
}
