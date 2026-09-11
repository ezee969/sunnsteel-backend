import type { ExercisePerformanceHistoryQuery } from "@sunsteel/contracts";
import { Type } from "class-transformer";
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class ExercisePerformanceHistoryQueryDto
  implements ExercisePerformanceHistoryQuery
{
  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}
