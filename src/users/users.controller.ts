// Utility
import { Controller, Get, UseGuards, Request } from '@nestjs/common';
// Services
import { UsersService } from './users.service';
// Guards
import { JwtAuthGuard } from 'src/auth/guards/passport-jwt.guard';
import { SupabaseJwtGuard } from 'src/auth/guards/supabase-jwt.guard';
// Types
import { Request as ExpressRequest } from 'express';
import { JwtPayload } from 'src/auth/types/jwt-payload.type';

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
