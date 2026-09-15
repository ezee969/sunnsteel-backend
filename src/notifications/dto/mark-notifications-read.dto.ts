import {
  NOTIFICATIONS_LIST_LIMIT,
  type MarkNotificationsReadRequest,
} from '@sunsteel/contracts';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class MarkNotificationsReadDto implements MarkNotificationsReadRequest {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(NOTIFICATIONS_LIST_LIMIT)
  @IsUUID('4', { each: true })
  ids?: string[];
}
