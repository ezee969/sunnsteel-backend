import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SupabaseJwtGuard } from "../auth/guards/supabase-jwt.guard";
import type { RequestWithUser } from "../common/types/request-with-user";
import { ListNotificationsQueryDto } from "./dto/list-notifications-query.dto";
import { MarkNotificationsReadDto } from "./dto/mark-notifications-read.dto";
import { NotificationsService } from "./notifications.service";

/** NOTIF-01: the owner's in-app notifications and their read state. */
@UseGuards(SupabaseJwtGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: RequestWithUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(req.user.id, query);
  }

  @Post("read")
  @HttpCode(200)
  markRead(@Req() req: RequestWithUser, @Body() dto: MarkNotificationsReadDto) {
    return this.notifications.markRead(req.user.id, dto.ids);
  }
}
