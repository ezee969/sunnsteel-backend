import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

/** SOC-03/SOC-04: generated activity and who may see it. */
@Module({
  imports: [DatabaseModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
