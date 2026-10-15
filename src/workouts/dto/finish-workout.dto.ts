import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { FinishStatus } from '@sunsteel/contracts';

export class FinishWorkoutDto {
  @IsEnum(['COMPLETED', 'ABORTED'])
  status!: FinishStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  // LIVE-24: when the workout ended; bounded in the finish service.
  @IsOptional()
  @IsISO8601({ strict: true })
  endedAt?: string;
}
