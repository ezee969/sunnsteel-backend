import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RELATIONSHIP_LIST_MAX_LIMIT } from '@sunsteel/contracts';

export class RelationshipListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RELATIONSHIP_LIST_MAX_LIMIT)
  limit?: number;
}
