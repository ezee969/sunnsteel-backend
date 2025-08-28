import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpsertSetLogDto {
  @IsString()
  routineExerciseId!: string;

  @IsString()
  exerciseId!: string;

  @IsNumber()
  @Min(1)
  setNumber!: number;

  @IsOptional()
  @IsNumber()
  reps?: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  rpe?: number;

  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;
}
