import { IsOptional, IsString } from 'class-validator';

/**
 * DTO for querying Training Max adjustments with filtering options
 *
 * Allows users to filter TM adjustments by exercise or other criteria
 */
export class GetTmAdjustmentsDto {
  /**
   * Optional exercise ID filter to show adjustments for specific exercise only
   */
  @IsOptional()
  @IsString()
  exerciseId?: string;
}
