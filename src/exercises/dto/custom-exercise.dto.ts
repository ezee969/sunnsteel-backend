import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_MECHANICS,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  type ExerciseEquipment,
  type ExerciseMechanic,
  type MovementPattern,
  type MuscleGroup,
} from '@sunsteel/contracts';

/**
 * EXER-06. Shapes only; the rules a complete exercise must meet (a primary
 * muscle, equipment, lengths after trimming) are contracts'
 * `customExerciseProblem`, applied by the service to the merged result.
 */
export class UpdateCustomExerciseDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MUSCLE_GROUPS.length)
  @IsIn(MUSCLE_GROUPS as unknown as string[], { each: true })
  primaryMuscles?: MuscleGroup[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MUSCLE_GROUPS.length)
  @IsIn(MUSCLE_GROUPS as unknown as string[], { each: true })
  secondaryMuscles?: MuscleGroup[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EXERCISE_EQUIPMENT.length)
  @IsIn(EXERCISE_EQUIPMENT as unknown as string[], { each: true })
  equipmentRequired?: ExerciseEquipment[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(MOVEMENT_PATTERNS as unknown as string[])
  movementPattern?: MovementPattern | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(EXERCISE_MECHANICS as unknown as string[])
  mechanic?: ExerciseMechanic | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class CreateCustomExerciseDto extends UpdateCustomExerciseDto {}
