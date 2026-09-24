import { SET_KINDS, type SetKind } from '@sunsteel/contracts';
import {
  IsBoolean,
  IsIn,
  IsInt,
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

  @IsInt()
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

  // LIVE-12
  @IsOptional()
  @IsIn(SET_KINDS)
  kind?: SetKind;
}
