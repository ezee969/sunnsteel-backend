import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Response,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { Response as ExpressResponse } from 'express';
import { SupabaseService } from './supabase.service';
import { SupabaseJwtGuard } from './guards/supabase-jwt.guard';
import { DatabaseService } from '../database/database.service';

interface SupabaseTokenDto {
  token: string;
}

interface UserMigrationDto {
  email: string;
  password: string;
}

@Controller('auth/supabase')
export class SupabaseAuthController {
  constructor(
    private supabaseService: SupabaseService,
    private databaseService: DatabaseService,
  ) {}

  /**
   * Verify Supabase token and return user profile
   * This replaces the old /auth/login endpoint for Supabase users
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyToken(
    @Body() { token }: SupabaseTokenDto,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    try {
      const supabaseUser = await this.supabaseService.verifyToken(token);
      const user = await this.supabaseService.getOrCreateUser(supabaseUser);

      // Set HttpOnly session cookie for middleware detection
      res.cookie('ss_session', '1', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/',
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          supabaseUserId: user.supabaseUserId,
          weightUnit: user.weightUnit,
        },
        message: 'Token verified successfully',
      };
    } catch (error) {
      // Clear session cookie on verification failure
      res.clearCookie('ss_session', { path: '/' });
      throw error;
    }
  }

  /**
   * Get user profile using Supabase JWT
   * This replaces the old /users/profile endpoint
   */
  @Get('profile')
  @UseGuards(SupabaseJwtGuard)
  async getProfile(@Request() req) {
    const user = req.user;

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        supabaseUserId: user.supabaseUserId,
        weightUnit: user.weightUnit,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  /**
   * Clear session cookie on logout
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Response({ passthrough: true }) res: ExpressResponse) {
    res.clearCookie('ss_session', { path: '/' });
    return { message: 'Logged out successfully' };
  }

  /**
   * Migration endpoint for existing users
   * Allows linking existing accounts to Supabase
   */
  @Post('migrate')
  async migrateUser(@Body() { email, password }: UserMigrationDto) {
    // This endpoint will be used during the migration phase
    // For now, it just validates that the user exists and password is correct
    const bcrypt = require('bcrypt');

    const user = await this.databaseService.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      throw new Error('User not found or already migrated');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error('Invalid password');
    }

    return {
      message: 'User validated for migration',
      userId: user.id,
      email: user.email,
    };
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'supabase-auth',
    };
  }
}
