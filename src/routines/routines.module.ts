import { Module } from '@nestjs/common';
import { RoutinesService } from './routines.service';
import { RoutinesController } from './routines.controller';
import { DatabaseModule } from '../database/database.module';
import { ConfigService } from '../configs/config.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RoutinesController],
  providers: [RoutinesService, ConfigService],
})
export class RoutinesModule {}
