import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
// TEMPORARY (TD-47): the probe reads user counts; removed with it.
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
})
export class HealthModule {}
