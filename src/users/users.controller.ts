import { Put } from '@nestjs/common';
import { AnalyticsService } from '../workouts/analytics/analytics.service';
import { SetAccountTimeZoneDto } from './dto/set-account-time-zone.dto';
// Utility
import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
  Query,
  Param,
  Post,
  Delete,
} from '@nestjs/common';
// Services
import { UsersService } from './users.service';
// Guards
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
// Types
import type { UpdateProfileRequest } from '@sunsteel/contracts';
import type { RequestWithUser } from '../common/types/request-with-user';
import { SearchUsersDto } from './dto/search-users.dto';
import { ReplaceTrainingLocationsDto } from './dto/replace-training-locations.dto';
import { UpdateProfileDiscoveryDto } from './dto/update-profile-discovery.dto';
import { UpdateProfilePrivacyDto } from './dto/update-profile-privacy.dto';
import { TrainingLocationPreferencesService } from './training-location-preferences.service';
import { UserRelationshipsService } from './user-relationships.service';
import { RelationshipListQueryDto } from './dto/relationship-list-query.dto';
import { FollowSuggestionsQueryDto } from './dto/follow-suggestions-query.dto';
import { MeasurableGoalsService } from '../goals/measurable-goals.service';
import { ReplaceMeasurableGoalsDto } from './dto/replace-measurable-goals.dto';
import { UpdatePlateauPreferencesDto } from './dto/update-plateau-preferences.dto';
import { PlateauPreferencesService } from './plateau-preferences.service';
import { RoutineSharingService } from '../routines/routine-sharing.service';
import { FeaturedProfileItemsService } from './featured-profile-items.service';
import { ReplaceFeaturedProfileItemsDto } from './dto/replace-featured-profile-items.dto';

@UseGuards(SupabaseJwtGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly analytics: AnalyticsService,
    private readonly trainingLocations: TrainingLocationPreferencesService,
    private readonly relationships: UserRelationshipsService,
    private readonly measurableGoals: MeasurableGoalsService,
    private readonly plateauPreferences: PlateauPreferencesService,
    private readonly routineSharing: RoutineSharingService,
    private readonly featuredProfileItems: FeaturedProfileItemsService,
  ) {}

  @Get('time-zone')
  analyticsStatus(@Request() req: RequestWithUser) {
    return this.analytics.status(req.user.id);
  }

  @Put('time-zone')
  setTimeZone(
    @Request() req: RequestWithUser,
    @Body() dto: SetAccountTimeZoneDto,
  ) {
    return this.analytics.setTimeZone(req.user.id, dto);
  }

  @Get('profile')
  getProfile(@Request() req: RequestWithUser) {
    return this.usersService.findByEmail(req.user.email);
  }

  @Patch('profile')
  updateProfile(
    @Request() req: RequestWithUser,
    @Body() data: UpdateProfileRequest,
  ) {
    return this.usersService.updateProfile(req.user.email, data);
  }

  @Put('profile/privacy')
  updateProfilePrivacy(
    @Request() req: RequestWithUser,
    @Body() data: UpdateProfilePrivacyDto,
  ) {
    return this.usersService.updateProfilePrivacy(req.user.email, data);
  }

  @Put('profile/discovery')
  updateProfileDiscovery(
    @Request() req: RequestWithUser,
    @Body() data: UpdateProfileDiscoveryDto,
  ) {
    return this.usersService.updateProfileDiscovery(req.user.email, data);
  }

  @Get('profile/featured')
  getFeaturedProfileItems(@Request() req: RequestWithUser) {
    return this.featuredProfileItems.list(req.user.id);
  }

  @Put('profile/featured')
  replaceFeaturedProfileItems(
    @Request() req: RequestWithUser,
    @Body() dto: ReplaceFeaturedProfileItemsDto,
  ) {
    return this.featuredProfileItems.replace(req.user.id, dto.items);
  }

  @Get('training-locations')
  getTrainingLocations(@Request() req: RequestWithUser) {
    return this.trainingLocations.list(req.user.id);
  }

  @Put('training-locations')
  replaceTrainingLocations(
    @Request() req: RequestWithUser,
    @Body() dto: ReplaceTrainingLocationsDto,
  ) {
    return this.trainingLocations.replace(req.user.id, dto.locations);
  }

  @Get('preferences/goals')
  getMeasurableGoals(@Request() req: RequestWithUser) {
    return this.measurableGoals.list(req.user.id);
  }

  @Put('preferences/goals')
  replaceMeasurableGoals(
    @Request() req: RequestWithUser,
    @Body() dto: ReplaceMeasurableGoalsDto,
  ) {
    return this.measurableGoals.replace(req.user.id, dto.goals);
  }

  @Put('preferences/plateaus')
  updatePlateauPreferences(
    @Request() req: RequestWithUser,
    @Body() dto: UpdatePlateauPreferencesDto,
  ) {
    return this.plateauPreferences.update(req.user.id, dto.minSessions);
  }

  @Get('search')
  searchUsers(@Request() req: RequestWithUser, @Query() query: SearchUsersDto) {
    return this.usersService.searchUsers(query.q, req.user.id, query.limit);
  }

  // `me` is a reserved username, so this cannot shadow a member's profile.
  @Get('me/suggestions')
  getFollowSuggestions(
    @Request() req: RequestWithUser,
    @Query() query: FollowSuggestionsQueryDto,
  ) {
    return this.relationships.suggestions(req.user.id, query.limit);
  }

  /**
   * ROUT-04: the member's routines this viewer may read. Both the account's
   * PROF-06 routines rule and each routine's own visibility apply, narrower
   * first, so a per-routine switch can never widen the account rule.
   */
  @Get(':identifier/routines')
  async getRoutines(
    @Request() req: RequestWithUser,
    @Param('identifier') identifier: string,
  ) {
    const ownerId = await this.routineSharing.resolveOwnerId(identifier);
    return this.routineSharing.listVisibleRoutines(req.user.id, ownerId);
  }

  /**
   * ROUT-05/PROF-08: one of that member's routines, when this viewer may read
   * it. `canViewRoutine` answers, and a routine that is not this member's is
   * 404 rather than a redirect to somebody else's.
   */
  @Get(':identifier/routines/:routineId')
  async getRoutine(
    @Request() req: RequestWithUser,
    @Param('identifier') identifier: string,
    @Param('routineId') routineId: string,
  ) {
    const ownerId = await this.routineSharing.resolveOwnerId(identifier);
    return this.routineSharing.readVisibleRoutine(
      req.user.id,
      routineId,
      ownerId,
    );
  }

  @Get(':identifier/followers')
  getFollowers(
    @Request() req: RequestWithUser,
    @Param('identifier') identifier: string,
    @Query() query: RelationshipListQueryDto,
  ) {
    return this.relationships.list(req.user.id, identifier, 'followers', query);
  }

  @Get(':identifier/following')
  getFollowing(
    @Request() req: RequestWithUser,
    @Param('identifier') identifier: string,
    @Query() query: RelationshipListQueryDto,
  ) {
    return this.relationships.list(req.user.id, identifier, 'following', query);
  }

  @Get(':identifier/mutuals')
  getMutuals(
    @Request() req: RequestWithUser,
    @Param('identifier') identifier: string,
    @Query() query: RelationshipListQueryDto,
  ) {
    return this.relationships.list(req.user.id, identifier, 'mutuals', query);
  }

  @Get(':identifier')
  getPublicProfile(
    @Request() req: RequestWithUser,
    @Param('identifier') identifier: string,
  ) {
    return this.usersService.getPublicProfile(req.user.id, identifier);
  }

  @Post(':id/follow')
  followUser(@Request() req: RequestWithUser, @Param('id') userId: string) {
    return this.usersService.followUser(req.user.id, userId);
  }

  @Delete(':id/follow')
  unfollowUser(@Request() req: RequestWithUser, @Param('id') userId: string) {
    return this.usersService.unfollowUser(req.user.id, userId);
  }
}
