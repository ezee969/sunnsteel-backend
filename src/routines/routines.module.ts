import { Module } from '@nestjs/common';
import { RoutinesService } from './routines.service';
import { RoutinesController } from './routines.controller';
import { DatabaseModule } from '../database/database.module';
import { RoutineVersionsController } from './routine-versions.controller';
import { RoutineVersionsService } from './routine-versions.service';
import {
  RoutineSharesController,
  SharedRoutinesController,
} from './routine-shares.controller';
import { RoutineSharingService } from './routine-sharing.service';
import { RoutineDiscoveryService } from './routine-discovery.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    RoutinesController,
    RoutineVersionsController,
    RoutineSharesController,
    SharedRoutinesController,
  ],
  providers: [
    RoutinesService,
    RoutineVersionsService,
    RoutineSharingService,
    RoutineDiscoveryService,
  ],
  exports: [RoutinesService, RoutineSharingService],
})
export class RoutinesModule {}
