import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  ConsumerRequestsController,
  ConsumerRequestsModerationController,
} from './consumer-requests.controller';
import { ConsumerRequestsService } from './consumer-requests.service';

/** BILL-07: the botón de arrepentimiento and the botón de baja. */
@Module({
  imports: [DatabaseModule],
  providers: [ConsumerRequestsService],
  controllers: [ConsumerRequestsController, ConsumerRequestsModerationController],
})
export class ConsumerRequestsModule {}
