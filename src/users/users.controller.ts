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
import { UpdateProfileRequest } from '@sunsteel/contracts';
import { RequestWithUser } from '../common/types/request-with-user';
import { SearchUsersDto } from './dto/search-users.dto';

@UseGuards(SupabaseJwtGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly analytics: AnalyticsService,
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

  @Get('search')
  searchUsers(@Request() req: RequestWithUser, @Query() query: SearchUsersDto) {
    return this.usersService.searchUsers(query.q, req.user.email, query.limit);
  }

  @Get(':id')
  getPublicProfile(
    @Request() req: RequestWithUser,
    @Param('id') userId: string,
  ) {
    return this.usersService.getPublicProfileById(req.user.id, userId);
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
