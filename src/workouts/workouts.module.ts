import { Module } from '@nestjs/common';
import { WorkoutMaintenanceService } from './workout-maintenance.service';
import { WorkoutsController } from './workouts.controller';
import { DatabaseModule } from '../database/database.module';
import { WorkoutsService } from './workouts.service';
import {
  WorkoutSessionFinishService,
  WorkoutSessionLogService,
  WorkoutSessionStartService,
} from './services';
import { WorkoutSessionReadService } from './workout-session-read.service';

@Module({
  imports: [DatabaseModule],
  controllers: [WorkoutsController],
  providers: [
    WorkoutsService,
    WorkoutMaintenanceService,
    WorkoutSessionStartService,
    WorkoutSessionFinishService,
    WorkoutSessionLogService,
    WorkoutSessionReadService,
  ],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
