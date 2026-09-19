import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ACTIVITY_ENTRY_ID_MAX_LENGTH,
  ACTIVITY_PAGE_MAX_LIMIT,
  ACTIVITY_PREVIEW_AUDIENCES,
  PROFILE_VISIBILITY_VALUES,
  type ActivityAudience,
  type ActivityPageQuery,
  type ActivityPreviewAudience,
  type ActivityPreviewQuery,
  type ActivityType,
  type SetActivityEntryAudienceRequest,
  type UpdateActivitySharingRequest,
} from '@sunsteel/contracts';

export class ActivityPageQueryDto implements ActivityPageQuery {
  @IsOptional()
  @IsString()
  // The cursor carries short digests of the entries returned at one instant.
  @MaxLength(12_000)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIVITY_PAGE_MAX_LIMIT)
  limit?: number;
}

export class ActivityPreviewQueryDto
  extends ActivityPageQueryDto
  implements ActivityPreviewQuery
{
  @IsIn(ACTIVITY_PREVIEW_AUDIENCES as unknown as string[])
  audience!: ActivityPreviewAudience;
}

/** Keys and values are checked by the service, which names what it refused. */
export class UpdateActivitySharingDto implements UpdateActivitySharingRequest {
  @IsObject()
  defaults!: Partial<Record<ActivityType, ActivityAudience>>;
}

export class SetActivityEntryAudienceDto
  implements SetActivityEntryAudienceRequest
{
  @IsString()
  @MinLength(1)
  @MaxLength(ACTIVITY_ENTRY_ID_MAX_LENGTH)
  entryId!: string;

  // `null` is a real value -- back to the type's default -- so only a
  // non-null audience is checked; a missing one fails the check.
  @ValidateIf((_, value) => value !== null)
  @IsIn(PROFILE_VISIBILITY_VALUES as unknown as string[])
  audience!: ActivityAudience | null;
}
