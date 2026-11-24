import type {
  AddSessionExerciseRequest,
  ReorderSessionExercisesRequest,
} from '@sunsteel/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateRoutineExerciseSetDto } from '../../routines/dto/create-routine.dto';

// LIVE-25: the schemes an exercise added during a workout may take. An
// 8-week block needs a reference max and a step, which the builder asks for.
const ADDABLE_SCHEMES = [
  'NONE',
  'DOUBLE_PROGRESSION',
  'DYNAMIC_DOUBLE_PROGRESSION',
] as const;

export class AddSessionExerciseDto implements AddSessionExerciseRequest {
  @IsString()
  @IsNotEmpty()
  exerciseId!: string;

  @IsInt()
  @Min(0)
  @Max(600)
  restSeconds!: number;

  @IsIn(ADDABLE_SCHEMES)
  progressionScheme!: (typeof ADDABLE_SCHEMES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  minWeightIncrement?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  // The same set rules as the builder; at most ten, as a routine allows.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateRoutineExerciseSetDto)
  sets!: CreateRoutineExerciseSetDto[];
}

export class ReorderSessionExercisesDto
  implements ReorderSessionExercisesRequest
{
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  routineExerciseIds!: string[];
}
