import {
  MODERATION_HISTORY_PAGE_SIZE,
  MODERATION_QUEUE_PAGE_SIZE,
  REPORT_STATUSES,
  REPORT_SUBJECT_KINDS,
  type ModerationHistoryQuery,
  type ModerationQueueQuery,
  type ReportStatus,
  type ReportSubjectKind,
} from '@sunsteel/contracts';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ModerationQueueQueryDto implements ModerationQueueQuery {
  @IsOptional()
  @IsIn(REPORT_STATUSES as unknown as string[])
  status?: ReportStatus;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MODERATION_QUEUE_PAGE_SIZE)
  limit?: number;
}

export class ModerationHistoryQueryDto implements ModerationHistoryQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MODERATION_HISTORY_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @IsIn(REPORT_SUBJECT_KINDS as unknown as string[])
  subjectKind?: ReportSubjectKind;

  @IsOptional()
  @IsString()
  subjectId?: string;
}
