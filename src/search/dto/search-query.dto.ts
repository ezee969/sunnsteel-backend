import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SEARCH_PAGE_SIZE_MAX,
  type SearchPageQuery,
  type SearchPreviewQuery,
} from '@sunsteel/contracts';

/**
 * The query is cut to `SEARCH_QUERY_MAX_LENGTH` before it is matched; the
 * bound here only refuses a request no client would send.
 */
export class SearchPreviewQueryDto implements SearchPreviewQuery {
  @IsString()
  @MaxLength(500)
  q: string;
}

export class SearchPageQueryDto implements SearchPageQuery {
  @IsString()
  @MaxLength(500)
  q: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_PAGE_SIZE_MAX)
  limit?: number;
}
