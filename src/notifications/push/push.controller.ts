import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../../common/types/request-with-user';
import { DeletePushSubscriptionDto } from './dto/delete-push-subscription.dto';
import { RegisterPushSubscriptionDto } from './dto/register-push-subscription.dto';
import { PushSubscriptionsService } from './push-subscriptions.service';

/** NOTIF-08: the owner's subscribed devices and the key the browser needs. */
@UseGuards(SupabaseJwtGuard)
@Controller('notifications/push')
export class PushController {
  constructor(private readonly subscriptions: PushSubscriptionsService) {}

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
