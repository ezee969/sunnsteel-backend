import type { UpsertBodyMeasurementRequest } from '@sunsteel/contracts';
import { IsNumber, IsOptional } from 'class-validator';

/** PROG-12. Bounds and "at least one value" are the contracts' rule, checked by the service. */
export class UpsertBodyMeasurementDto implements UpsertBodyMeasurementRequest {
  @IsOptional()
  @IsNumber()
  weightKg?: number | null;

  @IsOptional()
  @IsNumber()
  waistCm?: number | null;

  @IsOptional()
  @IsNumber()
  hipsCm?: number | null;

  @IsOptional()
  @IsNumber()
  chestCm?: number | null;

  @IsOptional()
  @IsNumber()
  armCm?: number | null;

  @IsOptional()
  @IsNumber()
  thighCm?: number | null;

  @IsOptional()
  @IsNumber()
  bodyFatPercent?: number | null;
}
