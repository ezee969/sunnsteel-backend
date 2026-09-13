import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { FOLLOW_SUGGESTIONS_MAX_LIMIT } from '@sunsteel/contracts';

export class FollowSuggestionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FOLLOW_SUGGESTIONS_MAX_LIMIT)
  limit?: number;
}
