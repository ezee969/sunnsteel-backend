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
import { RoutineDeloadsController } from './routine-deloads.controller';
import { RoutineDeloadsService } from './routine-deloads.service';
import { RoutineTrainingBlocksController } from './routine-training-blocks.controller';
import { RoutineTrainingBlocksService } from './routine-training-blocks.service';
import { ExercisesModule } from '../exercises/exercises.module';

@Module({
  imports: [DatabaseModule, ExercisesModule],
  controllers: [
    RoutinesController,
    RoutineVersionsController,
    RoutineTrainingBlocksController,
    RoutineDeloadsController,
    RoutineSharesController,
    SharedRoutinesController,
  ],
  providers: [
    RoutinesService,
    RoutineVersionsService,
    RoutineTrainingBlocksService,
    RoutineDeloadsService,
    RoutineSharingService,
    RoutineDiscoveryService,
  ],
  exports: [RoutinesService, RoutineSharingService],
})
export class RoutinesModule {}
