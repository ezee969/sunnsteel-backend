import {
  IsString,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  Max,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateTmEventRequest,
  TM_ADJUSTMENT_CONSTANTS,
} from '@sunsteel/contracts';

type TmAdjustmentLimits = {
  MAX_DELTA_KG: number;
  MIN_DELTA_KG: number;
  MIN_WEEK: number;
  MAX_WEEK: number;
  MAX_REASON_LENGTH: number;
};

const TM_ADJUSTMENT_LIMITS =
  TM_ADJUSTMENT_CONSTANTS as unknown as TmAdjustmentLimits;

const { MIN_WEEK, MAX_WEEK, MIN_DELTA_KG, MAX_DELTA_KG, MAX_REASON_LENGTH } =
  TM_ADJUSTMENT_LIMITS;

/**
 * DTO for creating a Training Max adjustment event
 *
 * Used when users need to adjust their training max for a specific exercise
 * based on performance feedback from reps-to-failure sets
 */
export class CreateTmEventDto implements CreateTmEventRequest {
  /**
   * ID of the exercise being adjusted
   */
  @IsString()
  exerciseId: string;

  /**
   * Week number in the program (1-21 for typical programs)
   */
  @Type(() => Number)
  @IsInt()
  @Min(MIN_WEEK)
  @Max(MAX_WEEK)
  weekNumber: number;

  /**
   * Change in training max (can be positive or negative)
   * Range: -15kg to +15kg for safety and reasonable progression
   */
  @Type(() => Number)
  @IsNumber()
  @Min(MIN_DELTA_KG)
  @Max(MAX_DELTA_KG)
  deltaKg: number;

  /**
   * Training max before the adjustment
   */
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  preTmKg: number;

  /**
   * Training max after the adjustment (preTmKg + deltaKg)
   */
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  postTmKg: number;

  /**
   * Optional reason for the adjustment (e.g., "Hit all reps easily", "Failed week 3")
   * Limited to 160 characters for conciseness
   */
  @IsOptional()
  @IsString()
  @Length(0, MAX_REASON_LENGTH)
  reason?: string;
}
