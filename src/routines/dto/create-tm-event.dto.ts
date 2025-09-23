import { IsString, IsInt, IsNumber, IsOptional, Min, Max, Length } from 'class-validator'
import { Transform, Type } from 'class-transformer'

/**
 * DTO for creating a Training Max adjustment event
 * 
 * Used when users need to adjust their training max for a specific exercise
 * based on performance feedback from reps-to-failure sets
 */
export class CreateTmEventDto {
	/**
	 * ID of the exercise being adjusted
	 */
	@IsString()
	exerciseId: string

	/**
	 * Week number in the program (1-21 for typical programs)
	 */
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(21)
	weekNumber: number

	/**
	 * Change in training max (can be positive or negative)
	 * Range: -15kg to +15kg for safety and reasonable progression
	 */
	@Type(() => Number)
	@IsNumber()
	@Min(-15)
	@Max(15)
	deltaKg: number

	/**
	 * Training max before the adjustment
	 */
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	preTmKg: number

	/**
	 * Training max after the adjustment (preTmKg + deltaKg)
	 */
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	postTmKg: number

	/**
	 * Optional reason for the adjustment (e.g., "Hit all reps easily", "Failed week 3")
	 * Limited to 160 characters for conciseness
	 */
	@IsOptional()
	@IsString()
	@Length(0, 160)
	reason?: string
}