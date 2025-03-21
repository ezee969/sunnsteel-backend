// Utility
import { Controller, Get, UseGuards, Request } from '@nestjs/common';
// Services
import { UsersService } from './users.service';
// Guards
import { JwtAuthGuard } from 'src/auth/guards/passport-jwt.guard';
// Types
import { Request as ExpressRequest } from 'express';
import { JwtPayload } from 'src/auth/types/jwt-payload.type';

interface RequestWithUser extends ExpressRequest {
  user: JwtPayload;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: RequestWithUser) {
    return this.usersService.findByEmail(req.user.email);
  }
}
