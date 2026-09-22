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
  ACTIVITY_COMMENT_MAX_LENGTH,
  ACTIVITY_COMMENTS_PAGE_SIZE,
  ACTIVITY_ENTRY_ID_MAX_LENGTH,
  ACTIVITY_PAGE_MAX_LIMIT,
  ACTIVITY_PREVIEW_AUDIENCES,
  ACTIVITY_REACTIONS,
  PROFILE_VISIBILITY_VALUES,
  type ActivityAudience,
  type ActivityCommentsQuery,
  type CreateActivityCommentRequest,
  type ActivityPageQuery,
  type ActivityPreviewAudience,
  type ActivityPreviewQuery,
  type ActivityReaction,
  type ActivityType,
  type SetActivityEntryAudienceRequest,
  type SetActivityReactionRequest,
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

export class SetActivityReactionDto implements SetActivityReactionRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(ACTIVITY_ENTRY_ID_MAX_LENGTH)
  entryId!: string;

  // `null` removes it, so only a non-null reaction is checked against the
  // catalog; a missing one fails, as it should.
  @ValidateIf((_, value) => value !== null)
  @IsIn(ACTIVITY_REACTIONS as unknown as string[])
  reaction!: ActivityReaction | null;
}

/** SOC-06: one entry's comments, paged. */
export class ActivityCommentsQueryDto implements ActivityCommentsQuery {
  @IsString()
  @MinLength(1)
  @MaxLength(ACTIVITY_ENTRY_ID_MAX_LENGTH)
  entryId!: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIVITY_COMMENTS_PAGE_SIZE)
  limit?: number;
}

/**
 * The length cap is checked here and again in `normalizeCommentBody`, which
 * trims first: a body of only whitespace passes `MinLength(1)` and is still
 * nothing to store, and one that is exactly at the cap before trimming is
 * within it after.
 */
export class CreateActivityCommentDto implements CreateActivityCommentRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(ACTIVITY_ENTRY_ID_MAX_LENGTH)
  entryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(ACTIVITY_COMMENT_MAX_LENGTH)
  body!: string;
}
