import { ForbiddenException } from '@nestjs/common';

/**
 * RoutineOwnershipException - Thrown when user doesn't own the routine
 */
export class RoutineOwnershipException extends ForbiddenException {
  constructor(routineId?: string) {
    super(
      routineId
        ? `Access denied: you do not own routine ${routineId}`
        : 'Access denied: you do not own this routine',
    );
  }
}
