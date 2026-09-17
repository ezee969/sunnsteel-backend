import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PushConfigService } from './push-config.service';
import { PushController } from './push.controller';
import { PushSenderService } from './push-sender.service';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { RestAlertService } from './rest-alert.service';
import { ScheduledPushService } from './scheduled-push.service';

/**
 * NOTIF-08 with its first payload, the NOTIF-03 rest alert. `RestAlertService`
 * is exported because the workouts module owns the session routes that create
 * and cancel an alert.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [PushController],
  providers: [
    PushConfigService,
    PushSubscriptionsService,
    PushSenderService,
    ScheduledPushService,
    RestAlertService,
  ],
  exports: [RestAlertService, PushSenderService],
})
export class PushModule {}
