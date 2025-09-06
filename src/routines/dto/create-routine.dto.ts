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
      PROGRAMMED_RTF: 'PROGRAMMED_RTF',
    } as const,
    {
      message:
        'progressionScheme must be NONE, DOUBLE_PROGRESSION, DYNAMIC_DOUBLE_PROGRESSION, or PROGRAMMED_RTF',
    },
  )
  progressionScheme?:
    | 'NONE'
    | 'DOUBLE_PROGRESSION'
    | 'DYNAMIC_DOUBLE_PROGRESSION'
    | 'PROGRAMMED_RTF';

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  minWeightIncrement?: number; // defaults to 2.5 if omitted

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutineExerciseSetDto)
  sets: CreateRoutineExerciseSetDto[];

  // RtF-specific fields when progressionScheme = PROGRAMMED_RTF
  @ValidateIf(
    (o: CreateRoutineExerciseDto) => o.progressionScheme === 'PROGRAMMED_RTF',
  )
  @IsNumber()
  @Min(1)
  programTMKg?: number;

  @ValidateIf(
    (o: CreateRoutineExerciseDto) => o.progressionScheme === 'PROGRAMMED_RTF',
  )
  @IsNumber()
  @Min(0.5)
  programRoundingKg?: number; // defaults to 2.5 if omitted
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

  // Routine-level program fields (only required if any exercise is PROGRAMMED_RTF)
  @IsOptional()
  @IsBoolean()
  programWithDeloads?: boolean; // true=21w; false=18w

  @IsOptional()
  @IsString()
  programStartDate?: string; // ISO date (yyyy-mm-dd)

  @IsOptional()
  @IsString()
  programTimezone?: string; // IANA TZ, e.g. "America/Argentina/Buenos_Aires"
}
