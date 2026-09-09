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
import { TrainingLocationPreferencesService } from './training-location-preferences.service';

@UseGuards(SupabaseJwtGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly analytics: AnalyticsService,
    private readonly trainingLocations: TrainingLocationPreferencesService,
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

  @Get('search')
  searchUsers(@Request() req: RequestWithUser, @Query() query: SearchUsersDto) {
    return this.usersService.searchUsers(query.q, req.user.id, query.limit);
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
