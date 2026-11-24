import {
  MATCH_MINI_SET_REPS_MAX,
  SET_KINDS,
  type SetKind,
} from '@sunsteel/contracts';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
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

  // LIVE-26: a match set's mini-sets; the count is checked by the service so
  // the refusal carries its code.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(MATCH_MINI_SET_REPS_MAX, { each: true })
  matchReps?: number[];
}
