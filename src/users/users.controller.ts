// Utility
import { Controller, Get, UseGuards, Request } from '@nestjs/common';
// Services
import { UsersService } from './users.service';
// Guards
import { SupabaseJwtGuard } from 'src/auth/guards/supabase-jwt.guard';
// Types
import { Request as ExpressRequest } from 'express';

interface RequestWithUser extends ExpressRequest {
	user: { id: string; email: string };
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(SupabaseJwtGuard)
  @Get('profile')
  getProfile(@Request() req: RequestWithUser) {
    return this.usersService.findByEmail(req.user.email);
  }
}
