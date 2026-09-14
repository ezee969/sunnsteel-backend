import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CreateRoutineRequest,
  CreateRoutineDayInput,
  CreateRoutineExerciseInput,
  ProgressionScheme,
  RepType,
  REP_TYPES,
  ROUTINE_DAY_NAME_MAX,
  ROUTINE_DAYS_MAX,
  ROUTINE_SCHEDULE_MODES,
  RoutineScheduleMode,
  RoutineSet,
} from '@sunsteel/contracts';

// Progression schemes accepted by the backend.
const LIVE_PROGRESSION_SCHEMES = [
  'NONE',
  'DOUBLE_PROGRESSION',
  'DYNAMIC_DOUBLE_PROGRESSION',
] as const satisfies readonly ProgressionScheme[];

type LiveProgressionScheme = (typeof LIVE_PROGRESSION_SCHEMES)[number];

const PROGRESSION_SCHEME_ERROR_MESSAGE = `progressionScheme must be one of: ${LIVE_PROGRESSION_SCHEMES.join(
  ', ',
)}`;

const REP_TYPE_VALUES: readonly RepType[] = REP_TYPES as readonly RepType[];

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

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  rir?: number | null;
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

  @IsOptional()
  @IsString()
  note?: string;

  // Progression configuration per exercise
  @IsIn(LIVE_PROGRESSION_SCHEMES, {
    message: PROGRESSION_SCHEME_ERROR_MESSAGE,
  })
  @IsNotEmpty()
  progressionScheme!: LiveProgressionScheme;

  @IsNumber()
  @Min(0.1)
  minWeightIncrement: number; // defaults to 2.5 if omitted

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoutineExerciseSetDto)
  sets: CreateRoutineExerciseSetDto[];
}

export class CreateRoutineDayDto implements CreateRoutineDayInput {
  // 0=Sun .. 6=Sat on a WEEKLY routine; omitted or null on a ROTATION one.
  // The pairing with the routine's mode is checked by normalizeRoutineDays.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(ROUTINE_DAY_NAME_MAX + 20) // trimmed, then checked exactly
  name?: string | null;

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

  @IsOptional()
  @IsIn(ROUTINE_SCHEDULE_MODES)
  scheduleMode?: RoutineScheduleMode;

  // SCHED-07: weekly routines only; checked against the days by
  // normalizeRestDays.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  restDays?: number[];

  @IsArray()
  @ArrayMaxSize(ROUTINE_DAYS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CreateRoutineDayDto)
  days: CreateRoutineDayDto[];
}
