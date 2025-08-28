import { IsOptional, IsString } from 'class-validator';

export class StartWorkoutDto {
  @IsString()
  routineId!: string;

  @IsString()
  routineDayId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
