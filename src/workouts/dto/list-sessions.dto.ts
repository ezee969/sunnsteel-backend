import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ListSessionsParams,
  WORKOUT_SESSION_STATUSES,
  WorkoutSessionStatus,
} from '@sunsteel/contracts';

export class ListSessionsDto implements ListSessionsParams {
  @IsOptional()
  @IsEnum(WORKOUT_SESSION_STATUSES)
  status?: WorkoutSessionStatus;

  @IsOptional()
  @IsUUID()
  routineId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  @IsIn([
    'finishedAt:desc',
    'finishedAt:asc',
    'startedAt:desc',
    'startedAt:asc',
  ])
  sort?:
    | 'finishedAt:desc'
    | 'finishedAt:asc'
    | 'startedAt:desc'
    | 'startedAt:asc';
}
