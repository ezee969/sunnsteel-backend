import { Transform } from 'class-transformer';
import { IsIn, IsString, Length } from 'class-validator';
import {
  ROUTINE_DRAFT_REQUEST_MAX,
  ROUTINE_DRAFT_REQUEST_MIN,
  SUPPORTED_LOCALES,
  type AppLocale,
  type CreateRoutineDraftRequest,
} from '@sunsteel/contracts';

export class CreateRoutineDraftDto implements CreateRoutineDraftRequest {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(ROUTINE_DRAFT_REQUEST_MIN, ROUTINE_DRAFT_REQUEST_MAX)
  request: string;

  @IsIn(SUPPORTED_LOCALES)
  locale: AppLocale;
}
