import {
  type AppLocale,
  SUPPORTED_LOCALES,
  type UpdateLocaleRequest,
} from '@sunsteel/contracts';
import { IsIn, ValidateIf } from 'class-validator';

/** I18N-02. `null` is a choice (follow the device); a missing value is not. */
export class UpdateLocaleDto implements UpdateLocaleRequest {
  @ValidateIf((dto: UpdateLocaleDto) => dto.locale !== null)
  @IsIn(SUPPORTED_LOCALES)
  locale!: AppLocale | null;
}
