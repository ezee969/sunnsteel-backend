import type { VolumeTrendQuery } from "@sunsteel/contracts";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsTimeZone, Max, Min } from "class-validator";

export class VolumeTrendQueryDto implements VolumeTrendQuery {
  @IsTimeZone()
  timeZone!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(12)
  weeks?: number;
}
