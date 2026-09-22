import { AnalyticsModule } from '../workouts/analytics/analytics.module';
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';
import { UsersController } from './users.controller';
import { TrainingLocationPreferencesService } from './training-location-preferences.service';
import { PublicProfilesController } from './public-profiles.controller';
import { UserRelationshipsService } from './user-relationships.service';
import { GoalsModule } from '../goals/goals.module';
import { PlateauPreferencesService } from './plateau-preferences.service';
import { FeaturedProfileItemsService } from './featured-profile-items.service';
import { MemberBlocksService } from './member-blocks.service';
import { MemberReportsService } from './member-reports.service';
import { MemberReportsController } from './member-reports.controller';
import { AchievementsModule } from '../achievements/achievements.module';
import { RoutinesModule } from '../routines/routines.module';
import { TrainingPartnersService } from './training-partners.service';

@Module({
  imports: [
    AnalyticsModule,
    GoalsModule,
    AchievementsModule,
    // ROUT-04: the member routines read applies the routine rules, which the
    // routines module owns.
    RoutinesModule,
  ],
  providers: [
    UsersService,
    TrainingLocationPreferencesService,
    PlateauPreferencesService,
    UserRelationshipsService,
    FeaturedProfileItemsService,
    MemberBlocksService,
    MemberReportsService,
    TrainingPartnersService,
    DatabaseService,
  ],
  exports: [UsersService],
  controllers: [
    UsersController,
    PublicProfilesController,
    MemberReportsController,
  ],
})
export class UsersModule {}
