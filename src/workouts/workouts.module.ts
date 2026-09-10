import { Module } from '@nestjs/common';
import { WorkoutsController } from './workouts.controller';
import { DatabaseModule } from '../database/database.module';
import { WorkoutsService } from './workouts.service';
import {
  WorkoutSessionFinishService,
  WorkoutSessionLogService,
  WorkoutSessionRecapService,
  WorkoutSessionStartService,
} from './services';
import { WorkoutSessionReadService } from './workout-session-read.service';
import { WorkoutProgressService } from './workout-progress.service';
import { WorkoutStrengthTrendService } from './workout-strength-trend.service';

@Module({
  imports: [DatabaseModule],
  controllers: [WorkoutsController],
  providers: [
    WorkoutsService,
    WorkoutSessionStartService,
    WorkoutSessionFinishService,
    WorkoutSessionLogService,
    WorkoutSessionRecapService,
    WorkoutSessionReadService,
    WorkoutProgressService,
    WorkoutStrengthTrendService,
  ],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
