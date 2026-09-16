import { AnalyticsModule } from '../workouts/analytics/analytics.module';
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';
import { UsersController } from './users.controller';
import { TokenModule } from '../token/token.module';
import { TrainingLocationPreferencesService } from './training-location-preferences.service';
import { PublicProfilesController } from './public-profiles.controller';
import { UserRelationshipsService } from './user-relationships.service';
import { GoalsModule } from '../goals/goals.module';
import { PlateauPreferencesService } from './plateau-preferences.service';
import { FeaturedProfileItemsService } from './featured-profile-items.service';

@Module({
  imports: [TokenModule, AnalyticsModule, GoalsModule],
  providers: [
    UsersService,
    TrainingLocationPreferencesService,
    PlateauPreferencesService,
    UserRelationshipsService,
    FeaturedProfileItemsService,
    DatabaseService,
  ],
  exports: [UsersService],
  controllers: [UsersController, PublicProfilesController],
})
export class UsersModule {}
