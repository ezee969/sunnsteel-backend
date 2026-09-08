import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  PlatePairInventory,
  ReplaceTrainingLocationsRequest,
  TrainingLocationPreferenceInput,
} from '@sunsteel/contracts';

export class PlatePairInventoryDto implements PlatePairInventory {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.05)
  @Max(100)
  weightKg!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  pairCount!: number;
}

export class TrainingLocationPreferenceInputDto
  implements TrainingLocationPreferenceInput
{
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsBoolean()
  isDefault!: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.5)
  @Max(100)
  barWeightKg!: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PlatePairInventoryDto)
  availablePlatePairs!: PlatePairInventoryDto[];

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  equipment!: string[];
}

export class ReplaceTrainingLocationsDto
  implements ReplaceTrainingLocationsRequest
{
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TrainingLocationPreferenceInputDto)
  locations!: TrainingLocationPreferenceInputDto[];
}
