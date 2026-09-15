import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ScheduleOverridesController } from './schedule-overrides.controller';
import { ScheduleOverridesService } from './schedule-overrides.service';

/** SCHED-04. Not `ScheduleModule`, which is `@nestjs/schedule`'s cron module. */
@Module({
  imports: [DatabaseModule],
  controllers: [ScheduleOverridesController],
  providers: [ScheduleOverridesService],
})
export class ScheduleOverridesModule {}
