// Utility
import { Controller, Get, Patch, Body, UseGuards, Request, Query } from '@nestjs/common';
// Services
import { UsersService } from './users.service';
// Guards
import { SupabaseJwtGuard } from 'src/auth/guards/supabase-jwt.guard';
// Types
import { Request as ExpressRequest } from 'express';
import { UpdateProfileRequest } from '@sunsteel/contracts';

interface RequestWithUser extends ExpressRequest {
  user: { id: string; email: string };
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @UseGuards(SupabaseJwtGuard)
  @Get('profile')
  getProfile(@Request() req: RequestWithUser) {
    return this.usersService.findByEmail(req.user.email);
  }

  @UseGuards(SupabaseJwtGuard)
  @Patch('profile')
  updateProfile(@Request() req: RequestWithUser, @Body() data: UpdateProfileRequest) {
    return this.usersService.updateProfile(req.user.email, data);
  }

  @UseGuards(SupabaseJwtGuard)
  @Get('search')
  searchUsers(@Request() req: RequestWithUser, @Query('q') query: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.usersService.searchUsers(query, req.user.email, limitNum);
  }
}
