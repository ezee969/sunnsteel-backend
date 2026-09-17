import {
  ROUTINE_VISIBILITY_VALUES,
  type RoutineVisibility,
  type UpdateRoutineVisibilityRequest,
} from '@sunsteel/contracts';
import { IsIn } from 'class-validator';

export class UpdateRoutineVisibilityDto
  implements UpdateRoutineVisibilityRequest
{
  @IsIn(ROUTINE_VISIBILITY_VALUES as unknown as string[])
  visibility!: RoutineVisibility;
}
