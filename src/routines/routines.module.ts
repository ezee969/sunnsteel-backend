import { Module } from '@nestjs/common';
import { RoutinesService } from './routines.service';
import { RoutinesController } from './routines.controller';
import { DatabaseModule } from '../database/database.module';
import { RoutineVersionsController } from './routine-versions.controller';
import { RoutineVersionsService } from './routine-versions.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RoutinesController, RoutineVersionsController],
  providers: [RoutinesService, RoutineVersionsService],
  exports: [RoutinesService],
})
export class RoutinesModule {}
