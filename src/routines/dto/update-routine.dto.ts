import { PartialType } from '@nestjs/mapped-types';
import { CreateRoutineDto } from './create-routine.dto';
import { UpdateRoutineRequest } from '@sunsteel/contracts';

/**
 * UpdateRoutineDto - DTO for updating existing routines
 *
 * Extends CreateRoutineDto as partial to allow selective updates.
 */
export class UpdateRoutineDto
  extends PartialType(CreateRoutineDto)
  implements UpdateRoutineRequest {}
