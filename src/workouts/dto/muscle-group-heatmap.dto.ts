import type { MuscleGroupHeatmapQuery } from "@sunsteel/contracts";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsTimeZone, Max, Min } from "class-validator";

export class MuscleGroupHeatmapQueryDto implements MuscleGroupHeatmapQuery {
  @IsTimeZone()
  timeZone!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(12)
  weeks?: number;
}
