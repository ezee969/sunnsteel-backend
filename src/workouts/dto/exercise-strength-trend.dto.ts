import type { ExerciseStrengthTrendQuery } from "@sunsteel/contracts";
import { IsISO8601, IsOptional, IsUUID } from "class-validator";

export class ExerciseStrengthTrendQueryDto implements ExerciseStrengthTrendQuery {
  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
