import {
  MODERATION_NOTE_MAX_LENGTH,
  type ReviewReportRequest,
} from '@sunsteel/contracts';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewReportDto implements ReviewReportRequest {
  @IsOptional()
  @IsString()
  @MaxLength(MODERATION_NOTE_MAX_LENGTH)
  note?: string | null;
}
