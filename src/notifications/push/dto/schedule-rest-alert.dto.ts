import type { ScheduleRestAlertRequest } from '@sunsteel/contracts';
import { IsISO8601, IsString, MaxLength, MinLength } from 'class-validator';

export class ScheduleRestAlertDto implements ScheduleRestAlertRequest {
  @IsISO8601()
  endsAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  exerciseName!: string;
}
