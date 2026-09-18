import type { CloneRoutineRequest } from '@sunsteel/contracts';
import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

/**
 * ROUT-05. Both fields are optional here and exactly one is required by
 * `readCloneSource`, which states why rather than leaving a caller with a
 * generic validation failure.
 */
export class CloneRoutineDto implements CloneRoutineRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  token?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  routineId?: string;
}
