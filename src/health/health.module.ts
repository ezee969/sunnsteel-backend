import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { HealthController } from './health.controller';

@Module({
  imports: [RealtimeModule],
  controllers: [HealthController],
})
export class HealthModule {}
