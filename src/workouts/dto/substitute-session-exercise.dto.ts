import type { SubstituteSessionExerciseRequest } from '@sunsteel/contracts';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SubstituteSessionExerciseDto
  implements SubstituteSessionExerciseRequest
{
  @IsString()
  @IsNotEmpty()
  exerciseId!: string;

  @IsOptional()
  @IsBoolean()
  applyToRoutine?: boolean;
}
