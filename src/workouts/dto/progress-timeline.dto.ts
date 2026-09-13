import {
  PROGRESS_TIMELINE_EVENT_TYPES,
  type ProgressTimelineEventType,
  type ProgressTimelineQuery,
} from "@sunsteel/contracts";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class ProgressTimelineQueryDto implements ProgressTimelineQuery {
  @IsOptional()
  @IsIn(PROGRESS_TIMELINE_EVENT_TYPES)
  type?: ProgressTimelineEventType;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
