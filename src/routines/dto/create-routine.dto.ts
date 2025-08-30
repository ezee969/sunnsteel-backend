import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export enum RepTypeDto {
  FIXED = 'FIXED',
  RANGE = 'RANGE',
}

export class CreateRoutineExerciseSetDto {
  @IsInt()
  @Min(1)
  @Max(10)
  setNumber: number;

  // Rep prescription type
  @IsEnum(RepTypeDto)
  repType: RepTypeDto;

  // When repType is FIXED, reps must be provided
  @ValidateIf(
    (o: CreateRoutineExerciseSetDto) => o.repType === RepTypeDto.FIXED,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  reps?: number;

  // When repType is RANGE, minReps/maxReps must be provided
  @ValidateIf(
    (o: CreateRoutineExerciseSetDto) => o.repType === RepTypeDto.RANGE,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  minReps?: number;

  @ValidateIf(
    (o: CreateRoutineExerciseSetDto) => o.repType === RepTypeDto.RANGE,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  maxReps?: number;

  @IsOptional()
  weight?: number;
}

export class CreateRoutineExerciseDto {
  @IsString()
  @IsNotEmpty()
  exerciseId: string;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsInt()
  @Min(0)
  @Max(600)
  restSeconds: number;

  // Progression configuration per exercise
  @IsOptional()
  @IsEnum(
    {
      NONE: 'NONE',
      DOUBLE_PROGRESSION: 'DOUBLE_PROGRESSION',
      DYNAMIC_DOUBLE_PROGRESSION: 'DYNAMIC_DOUBLE_PROGRESSION',
    } as const,
    {
      message:
        'progressionScheme must be NONE, DOUBLE_PROGRESSION, or DYNAMIC_DOUBLE_PROGRESSION',
    },
  )
  progressionScheme?:
    | 'NONE'
    | 'DOUBLE_PROGRESSION'
    | 'DYNAMIC_DOUBLE_PROGRESSION';

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  minWeightIncrement?: number; // defaults to 2.5 if omitted

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutineExerciseSetDto)
  sets: CreateRoutineExerciseSetDto[];
}

export class CreateRoutineDayDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number; // 0=Sun .. 6=Sat

  @IsOptional()
  @IsInt()
  order?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutineExerciseDto)
  exercises: CreateRoutineExerciseDto[];
}

export class CreateRoutineDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  description?: string;

  @IsBoolean()
  isPeriodized: boolean; // must be false for now

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutineDayDto)
  days: CreateRoutineDayDto[];
}
