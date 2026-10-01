import {
  NOTIFICATIONS_PAGE_SIZE_MAX,
  type MarkNotificationsReadRequest,
} from "@sunsteel/contracts";
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from "class-validator";

export class MarkNotificationsReadDto implements MarkNotificationsReadRequest {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(NOTIFICATIONS_PAGE_SIZE_MAX)
  @IsUUID("4", { each: true })
  ids?: string[];
}
