import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
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
import {
  CreateRoutineRequest,
  CreateRoutineDayInput,
  CreateRoutineExerciseInput,
  ProgramStyle,
  PROGRAM_STYLES,
  ProgressionScheme,
  PROGRESSION_SCHEMES,
  RepType,
  REP_TYPES,
  RoutineSet,
} from '@sunsteel/contracts';

const PROGRESSION_SCHEME_VALUES: readonly ProgressionScheme[] =
  PROGRESSION_SCHEMES as readonly ProgressionScheme[];

const REP_TYPE_VALUES: readonly RepType[] = REP_TYPES as readonly RepType[];

const PROGRAM_STYLE_VALUES: readonly ProgramStyle[] =
  PROGRAM_STYLES as readonly ProgramStyle[];

export class CreateRoutineExerciseSetDto implements RoutineSet {
  @IsInt()
  @Min(1)
  @Max(10)
  setNumber: number;

  // Rep prescription type
  @IsIn(REP_TYPE_VALUES)
  repType: RepType;

  // When repType is FIXED, reps must be provided
  @ValidateIf((o: CreateRoutineExerciseSetDto) => o.repType === 'FIXED')
  @IsInt()
  @Min(1)
  @Max(50)
  reps?: number;

  // When repType is RANGE, minReps/maxReps must be provided
  @ValidateIf((o: CreateRoutineExerciseSetDto) => o.repType === 'RANGE')
  @IsInt()
  @Min(1)
  @Max(50)
  minReps?: number;

  @ValidateIf((o: CreateRoutineExerciseSetDto) => o.repType === 'RANGE')
  @IsInt()
  @Min(1)
  @Max(50)
  maxReps?: number;

  @IsOptional()
  weight?: number | null;
}

export class CreateRoutineExerciseDto implements CreateRoutineExerciseInput {
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
  @IsIn(PROGRESSION_SCHEME_VALUES, {
    message:
      'progressionScheme must be NONE, DOUBLE_PROGRESSION, DYNAMIC_DOUBLE_PROGRESSION, or PROGRAMMED_RTF',
  })
  @IsNotEmpty()
  progressionScheme!: ProgressionScheme;

  @IsNumber()
  @Min(0.1)
  minWeightIncrement: number; // defaults to 2.5 if omitted

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutineExerciseSetDto)
  sets: CreateRoutineExerciseSetDto[];

  // RtF-specific fields when progressionScheme is PROGRAMMED_RTF
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

  // Program style for PROGRAMMED_RTF exercises (unified scheme)
  @ValidateIf(
    (o: CreateRoutineExerciseDto) => o.progressionScheme === 'PROGRAMMED_RTF',
  )
  @IsIn(PROGRAM_STYLE_VALUES, {
    message:
      'programStyle must be STANDARD or HYPERTROPHY for PROGRAMMED_RTF exercises',
  })
  programStyle?: ProgramStyle;
}

export class CreateRoutineDayDto implements CreateRoutineDayInput {
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

export class CreateRoutineDto implements CreateRoutineRequest {
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

  // Start program at a specific calendar week (create-time feature). Clamped server-side to [1..(18|21)].
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(21)
  programStartWeek?: number;

  // Program style (variant) for PROGRAMMED_RTF routines (front-end metadata persisted)
  @IsOptional()
  @IsIn(PROGRAM_STYLE_VALUES, {
    message: 'programStyle must be STANDARD or HYPERTROPHY',
  })
  programStyle?: ProgramStyle;
}
