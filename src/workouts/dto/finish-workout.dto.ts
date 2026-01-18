import { IsEnum, IsOptional, IsString } from 'class-validator';
import { FinishStatus } from '@sunsteel/contracts';

export class FinishWorkoutDto {
  @IsEnum(['COMPLETED', 'ABORTED'])
  status!: FinishStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
