import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  REPORT_SUBJECT_KINDS,
  type CreateReportRequest,
  type ReportReason,
  type ReportSubjectKind,
} from '@sunsteel/contracts';
import { IsIn, IsOptional, IsString, MaxLength, IsNotEmpty } from 'class-validator';

export class CreateReportDto implements CreateReportRequest {
  @IsIn(REPORT_SUBJECT_KINDS as unknown as string[])
  subjectKind!: ReportSubjectKind;

  @IsString()
  @IsNotEmpty()
  subjectId!: string;

  @IsIn(REPORT_REASONS as unknown as string[])
  reason!: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(REPORT_DETAILS_MAX_LENGTH)
  details?: string | null;
}
