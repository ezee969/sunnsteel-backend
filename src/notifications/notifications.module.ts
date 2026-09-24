import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PushModule } from './push/push.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PartnerActivityAlertsService } from './partner-activity-alerts.service';

/** NOTIF-01: the in-app notification center. */
@Module({
  imports: [DatabaseModule, PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PartnerActivityAlertsService],
})
export class NotificationsModule {}
