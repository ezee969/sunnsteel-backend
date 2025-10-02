import { Module } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { WorkoutMaintenanceService } from './workout-maintenance.service';
import { WorkoutsController } from './workouts.controller';
import { DatabaseModule } from '../database/database.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [DatabaseModule, CacheModule],
  controllers: [WorkoutsController],
  providers: [WorkoutsService, WorkoutMaintenanceService],
  // Export service so other feature modules (e.g. Routines) can optionally
  // reuse RtF helper logic (RTF-B02 inclusion parameter for routine detail)
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
