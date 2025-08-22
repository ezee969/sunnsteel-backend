import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateRoutineExerciseSetDto {
  @IsInt()
  @Min(1)
  @Max(10)
  setNumber: number;

  @IsInt()
  @Min(1)
  @Max(50)
  reps: number;

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
