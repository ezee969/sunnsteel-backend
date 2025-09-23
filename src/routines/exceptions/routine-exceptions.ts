import { BadRequestException, ForbiddenException } from '@nestjs/common'

/**
 * RoutineOwnershipException - Thrown when user doesn't own the routine
 */
export class RoutineOwnershipException extends ForbiddenException {
	constructor(routineId?: string) {
		super(
			routineId 
				? `Access denied: you do not own routine ${routineId}` 
				: 'Access denied: you do not own this routine'
		)
	}
}

/**
 * InvalidProgramStyleException - Thrown when invalid program style is provided
 */
export class InvalidProgramStyleException extends BadRequestException {
	constructor(providedStyle?: string) {
		super(
			providedStyle 
				? `Invalid program style: ${providedStyle}. Must be STANDARD or HYPERTROPHY`
				: 'Invalid program style. Must be STANDARD or HYPERTROPHY'
		)
	}
}

/**
 * TmEventNotAllowedException - Thrown when TM events aren't supported for the routine
 */
export class TmEventNotAllowedException extends BadRequestException {
	constructor(reason?: string) {
		super(
			reason 
				? `TM events not allowed: ${reason}`
				: 'TM events are only supported for PROGRAMMED_RTF routines'
		)
	}
}