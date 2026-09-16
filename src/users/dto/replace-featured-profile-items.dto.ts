import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  FeaturedProfileItemKind,
  FeaturedProfileSelectionInput,
  ReplaceFeaturedProfileItemsRequest,
} from '@sunsteel/contracts';
import {
  FEATURED_PROFILE_ITEM_KINDS,
  FEATURED_PROFILE_ITEMS_MAX,
  FEATURED_PROFILE_REFERENCE_MAX_LENGTH,
} from '@sunsteel/contracts';

export class FeaturedProfileSelectionInputDto
  implements FeaturedProfileSelectionInput
{
  @IsIn(FEATURED_PROFILE_ITEM_KINDS)
  kind!: FeaturedProfileItemKind;

  @IsString()
  @MinLength(1)
  @MaxLength(FEATURED_PROFILE_REFERENCE_MAX_LENGTH)
  referenceId!: string;
}

export class ReplaceFeaturedProfileItemsDto
  implements ReplaceFeaturedProfileItemsRequest
{
  @IsArray()
  @ArrayMaxSize(FEATURED_PROFILE_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => FeaturedProfileSelectionInputDto)
  items!: FeaturedProfileSelectionInputDto[];
}
