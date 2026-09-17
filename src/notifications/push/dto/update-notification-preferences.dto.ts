import {
  MINUTES_IN_DAY,
  type NotificationCategory,
  type QuietHours,
  type UpdateNotificationPreferencesRequest,
} from '@sunsteel/contracts';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class NotificationCategoriesDto
  implements Partial<Record<NotificationCategory, boolean>>
{
  @IsOptional()
  @IsBoolean()
  REST_ALERT?: boolean;

  @IsOptional()
  @IsBoolean()
  TRAINING_REMINDER?: boolean;
}

class QuietHoursDto implements QuietHours {
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY - 1)
  startMinute!: number;

  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY - 1)
  endMinute!: number;
}

class TrainingReminderDto {
  /** Null switches reminders off without discarding the chosen time. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY - 1)
  minuteOfDay!: number | null;
}

export class UpdateNotificationPreferencesDto
  implements UpdateNotificationPreferencesRequest
{
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationCategoriesDto)
  categories?: NotificationCategoriesDto;

  /**
   * Omitting it keeps the stored window; sending null clears it. The global
   * pipe strips unknown keys, so the two intents stay distinguishable.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => TrainingReminderDto)
  reminder?: TrainingReminderDto;
}
