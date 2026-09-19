import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EXERCISE_EQUIPMENT,
  MUSCLE_GROUPS,
  ROUTINE_DISCOVERY_MAX_LIMIT,
  ROUTINE_DURATION_BANDS,
  ROUTINE_DAYS_MAX,
  TRAINING_EXPERIENCE_LEVEL_VALUES,
  TRAINING_GOAL_VALUES,
  type ExerciseEquipment,
  type MuscleGroup,
  type RoutineDiscoveryQuery,
  type RoutineDurationBand,
  type TrainingExperienceLevel,
  type TrainingGoal,
} from '@sunsteel/contracts';

/** ROUT-07: every filter optional; omitting one asks nothing of it. */
export class DiscoverRoutinesDto implements RoutineDiscoveryQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(TRAINING_GOAL_VALUES as unknown as string[])
  goal?: TrainingGoal;

  @IsOptional()
  @IsIn(TRAINING_EXPERIENCE_LEVEL_VALUES as unknown as string[])
  experienceLevel?: TrainingExperienceLevel;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROUTINE_DAYS_MAX)
  days?: number;

  @IsOptional()
  @IsIn(MUSCLE_GROUPS as unknown as string[])
  muscle?: MuscleGroup;

  // A repeated query parameter arrives as a string when sent once.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value],
  )
  @IsArray()
  @IsIn(EXERCISE_EQUIPMENT as unknown as string[], { each: true })
  equipment?: ExerciseEquipment[];

  @IsOptional()
  @IsIn(ROUTINE_DURATION_BANDS as unknown as string[])
  duration?: RoutineDurationBand;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROUTINE_DISCOVERY_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
