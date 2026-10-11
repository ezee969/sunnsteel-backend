import {
  type LoggedBlockStep,
  type LoggedSetInput,
  type LogPastWorkoutRequest,
  SET_KINDS,
  type SetKind,
} from '@sunsteel/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// LIVE-23. Shapes only; the rules (dates, bounds, sets of the day) live in
// logged-workout-rules.ts, which applies them.
class LoggedSetDto implements LoggedSetInput {
  @IsString()
  @IsNotEmpty()
  routineExerciseId!: string;

  @IsInt()
  setNumber!: number;

  @IsNumber()
  reps!: number;

  @IsNumber()
  weight!: number;

  @IsOptional()
  @IsNumber()
  rpe?: number | null;

  @IsBoolean()
  isCompleted!: boolean;

  @IsOptional()
  @IsIn(SET_KINDS)
  kind?: SetKind;
}

class LoggedBlockStepDto implements LoggedBlockStep {
  @IsString()
  @IsNotEmpty()
  routineExerciseId!: string;

  @IsInt()
  step!: number;
}

export class LogPastWorkoutDto implements LogPastWorkoutRequest {
  @IsString()
  @IsNotEmpty()
  routineId!: string;

  @IsString()
  @IsNotEmpty()
  routineDayId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute?: number;

  @IsOptional()
  @IsInt()
  durationSec?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LoggedBlockStepDto)
  lpSteps?: LoggedBlockStepDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => LoggedSetDto)
  sets!: LoggedSetDto[];
}
