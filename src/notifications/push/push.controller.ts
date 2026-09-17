import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../../common/types/request-with-user';
import { DeletePushSubscriptionDto } from './dto/delete-push-subscription.dto';
import { RegisterPushSubscriptionDto } from './dto/register-push-subscription.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

/** NOTIF-08: the owner's subscribed devices and the key the browser needs. */
@UseGuards(SupabaseJwtGuard)
@Controller('notifications/push')
export class PushController {
  constructor(
    private readonly subscriptions: PushSubscriptionsService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  @Get('subscriptions')
  list(@Req() req: RequestWithUser) {
    return this.subscriptions.list(req.user.id);
  }

  @Post('subscriptions')
  @HttpCode(200)
  register(
    @Req() req: RequestWithUser,
    @Body() dto: RegisterPushSubscriptionDto,
  ) {
    return this.subscriptions.register(req.user.id, dto);
  }

  @Delete('subscriptions')
  @HttpCode(200)
  remove(
    @Req() req: RequestWithUser,
    @Body() dto: DeletePushSubscriptionDto,
  ) {
    return this.subscriptions.remove(req.user.id, dto.endpoint);
  }
}

/** NOTIF-05: the switches every delivered notification is checked against. */
@UseGuards(SupabaseJwtGuard)
@Controller('notifications/preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  read(@Req() req: RequestWithUser) {
    return this.preferences.read(req.user.id);
  }

  @Put()
  @HttpCode(200)
  update(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.preferences.update(req.user.id, dto);
  }
}
