import {
  NOTIFICATIONS_PAGE_SIZE_MAX,
  type NotificationsQuery,
} from "@sunsteel/contracts";
import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/** NOTIF-09: one page of the notification list. */
export class ListNotificationsQueryDto implements NotificationsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATIONS_PAGE_SIZE_MAX)
  limit?: number;

  // An ISO instant and a UUID, base64url-encoded; anything longer is not one.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
