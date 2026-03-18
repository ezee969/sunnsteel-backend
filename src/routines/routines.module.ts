import { Module } from '@nestjs/common';
import { RoutinesService } from './routines.service';
import { RoutinesController } from './routines.controller';
import { DatabaseModule } from '../database/database.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { CacheModule } from '../cache/cache.module';
import { RoutinesTmService } from './routines-tm.service';

@Module({
  imports: [DatabaseModule, WorkoutsModule, CacheModule],
  controllers: [RoutinesController],
  providers: [RoutinesService, RoutinesTmService],
  exports: [RoutinesService, RoutinesTmService],
})
export class RoutinesModule {}
