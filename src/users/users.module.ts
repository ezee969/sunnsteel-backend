import { AnalyticsModule } from '../workouts/analytics/analytics.module';
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';
import { UsersController } from './users.controller';
import { TokenModule } from '../token/token.module';
import { TrainingLocationPreferencesService } from './training-location-preferences.service';

@Module({
  imports: [TokenModule, AnalyticsModule],
  providers: [UsersService, TrainingLocationPreferencesService, DatabaseService],
  exports: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
