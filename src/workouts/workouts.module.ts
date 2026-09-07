import { Module } from '@nestjs/common';
import { WorkoutsController } from './workouts.controller';
import { DatabaseModule } from '../database/database.module';
import { WorkoutsService } from './workouts.service';
import {
  WorkoutSessionFinishService,
  WorkoutSessionLogService,
  WorkoutSessionStartService,
} from './services';
import { WorkoutSessionReadService } from './workout-session-read.service';
import { WorkoutProgressService } from './workout-progress.service';

@Module({
  imports: [DatabaseModule],
  controllers: [WorkoutsController],
  providers: [
    WorkoutsService,
    WorkoutSessionStartService,
    WorkoutSessionFinishService,
    WorkoutSessionLogService,
    WorkoutSessionReadService,
    WorkoutProgressService,
  ],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
