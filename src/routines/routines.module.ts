import { Module } from '@nestjs/common';
import { RoutinesService } from './routines.service';
import { RoutinesController } from './routines.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [RoutinesController],
  providers: [RoutinesService],
  exports: [RoutinesService],
})
export class RoutinesModule {}
