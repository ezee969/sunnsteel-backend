import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum FinishStatusDto {
  COMPLETED = 'COMPLETED',
  ABORTED = 'ABORTED',
}

export class FinishWorkoutDto {
  @IsEnum(FinishStatusDto)
  status!: FinishStatusDto;

  @IsOptional()
  @IsString()
  notes?: string;
}
