import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  IsNumber,
  IsOptional,
  MaxLength,
} from 'class-validator';

/**
 * CreateTmEventDto - DTO for creating training max adjustment events
 *
 * Used when users adjust their training max based on performance
 * in Programmed RtF routines.
 */
export class CreateTmEventDto {
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
  @Min(1)
  weekNumber: number;

  /**
   * Change in training max (kg)
   * Positive values indicate increases, negative for decreases
   */
  @IsNumber()
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
  @MaxLength(160)
  reason?: string;
}

/**
 * TmEventSummaryDto - Summary statistics for TM adjustments per exercise
 */
export class TmEventSummaryDto {
  exerciseId: string;
  exerciseName: string;
  events: number;
  netDelta: number;
  avgChange: number;
  lastEventAt: Date | null;
}

/**
 * TmEventResponseDto - Response format for TM adjustment events
 */
export class TmEventResponseDto {
  id: string;
  exerciseId: string;
  weekNumber: number;
  deltaKg: number;
  preTmKg: number;
  postTmKg: number;
  reason: string | null;
  style: 'STANDARD' | 'HYPERTROPHY' | null;
  createdAt: Date;
}
