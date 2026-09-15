import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CreateRoutineVersionRequest,
  ROUTINE_VERSION_NAME_MAX,
} from '@sunsteel/contracts';

export class CreateRoutineVersionDto implements CreateRoutineVersionRequest {
  @IsOptional()
  @IsString()
  @MaxLength(ROUTINE_VERSION_NAME_MAX + 20) // trimmed, then checked exactly
  name?: string | null;
}
