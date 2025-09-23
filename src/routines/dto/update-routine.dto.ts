import { PartialType } from '@nestjs/mapped-types'
import { CreateRoutineDto } from './create-routine.dto'
import { IsOptional, IsIn } from 'class-validator'

/**
 * UpdateRoutineDto - DTO for updating existing routines
 * 
 * Extends CreateRoutineDto as partial to allow selective updates.
 * Includes validation for programStyle when progressionScheme is PROGRAMMED_RTF.
 */
export class UpdateRoutineDto extends PartialType(CreateRoutineDto) {
	/**
	 * Program style for PROGRAMMED_RTF routines
	 * Only valid when progressionScheme is PROGRAMMED_RTF
	 * Automatically cleared if scheme changes away from PROGRAMMED_RTF
	 */
	@IsOptional()
	@IsIn(['STANDARD', 'HYPERTROPHY'], {
		message: 'programStyle must be STANDARD or HYPERTROPHY'
	})
	programStyle?: 'STANDARD' | 'HYPERTROPHY'
}