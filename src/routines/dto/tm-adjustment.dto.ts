import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  IsNumber,
  IsOptional,
  MaxLength,
  Max,
} from 'class-validator';
import {
  CreateTmEventRequest,
  TmEventSummary,
  TmEventResponse,
  ProgramStyle,
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

const { MIN_WEEK, MAX_DELTA_KG, MIN_DELTA_KG, MAX_REASON_LENGTH } =
  TM_ADJUSTMENT_LIMITS;

// Decorator helpers (class-validator signatures expect `number` types)
const maxDeltaGuard = MAX_DELTA_KG;
const minDeltaGuard = MIN_DELTA_KG;
const minWeekGuard = MIN_WEEK;
const maxReasonLengthGuard = MAX_REASON_LENGTH;

/**
 * CreateTmEventDto - DTO for creating training max adjustment events
 *
 * Used when users adjust their training max based on performance
 * in Programmed RtF routines.
 */
export class CreateTmEventDto implements CreateTmEventRequest {
  /**
   * Exercise ID for which the TM is being adjusted
   */
  @IsString()
  @IsNotEmpty()
  exerciseId: string;

  /**
   * Week number in the program when adjustment occurred
   */
  @IsInt()
  @Min(minWeekGuard)
  weekNumber: number;

  /**
   * Change in training max (kg)
   * Positive values indicate increases, negative for decreases
   */
  @IsNumber()
  @Min(minDeltaGuard)
  @Max(maxDeltaGuard)
  deltaKg: number;

  /**
   * Training max before the adjustment (kg)
   */
  @IsNumber()
  preTmKg: number;

  /**
   * Training max after the adjustment (kg)
   * Should equal preTmKg + deltaKg
   */
  @IsNumber()
  postTmKg: number;

  /**
   * Optional reason for the adjustment
   */
  @IsOptional()
  @IsString()
  @MaxLength(maxReasonLengthGuard)
  reason?: string;
}

/**
 * TmEventSummaryDto - Summary statistics for TM adjustments per exercise
 */
export class TmEventSummaryDto implements TmEventSummary {
  exerciseId: string;
  exerciseName: string;
  totalDeltaKg: number;
  averageDeltaKg: number;
  adjustmentCount: number;
  lastAdjustmentDate: string | null;
}

/**
 * TmEventResponseDto - Response format for TM adjustment events
 */
export class TmEventResponseDto implements TmEventResponse {
  id: string;
  routineId: string;
  exerciseId: string;
  exerciseName: string;
  weekNumber: number;
  deltaKg: number;
  preTmKg: number;
  postTmKg: number;
  reason?: string;
  style: ProgramStyle | null;
  createdAt: string;
}
