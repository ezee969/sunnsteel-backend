import { IsOptional, IsString } from 'class-validator';
import { StartWorkoutRequest } from '@sunsteel/contracts';

export class StartWorkoutDto implements StartWorkoutRequest {
  @IsString()
  routineId!: string;

  @IsString()
  routineDayId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
