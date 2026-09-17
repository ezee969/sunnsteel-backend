import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PushConfigService } from './push-config.service';
import { NotificationPreferencesController, PushController } from './push.controller';
import { PushSenderService } from './push-sender.service';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { RestAlertService } from './rest-alert.service';
import { ScheduledPushService } from './scheduled-push.service';
import { TrainingReminderService } from './training-reminder.service';

/**
 * NOTIF-08 with its first payload, the NOTIF-03 rest alert. `RestAlertService`
 * is exported because the workouts module owns the session routes that create
 * and cancel an alert.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [PushController, NotificationPreferencesController],
  providers: [
    PushConfigService,
    NotificationPreferencesService,
    PushSubscriptionsService,
    PushSenderService,
    ScheduledPushService,
    RestAlertService,
    TrainingReminderService,
  ],
  exports: [RestAlertService, PushSenderService],
})
export class PushModule {}
