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
    const startTime = Date.now();
    let isNewUser = false;

    try {
      console.log('[Signup Analytics] Token verification started');
      
      const supabaseUser = await this.supabaseService.verifyToken(token);
      
      // Check if user exists before getOrCreate to track new signups
      const existingUser = await this.supabaseService.getUserBySupabaseId(
        supabaseUser.id,
      );
      isNewUser = !existingUser;

      const user = await this.supabaseService.getOrCreateUser(supabaseUser);

      // Set HttpOnly session cookie for middleware detection
      res.cookie('ss_session', '1', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/',
      });

      const duration = Date.now() - startTime;

      // Log signup analytics
      if (isNewUser) {
        console.log('[Signup Analytics] New user created', {
          userId: user.id,
          email: user.email,
          supabaseUserId: user.supabaseUserId,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString(),
        });
      } else {
        console.log('[Signup Analytics] Existing user verified', {
          userId: user.id,
          email: user.email,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString(),
        });
      }

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
      const duration = Date.now() - startTime;

      // Log verification failure with full details
      console.error('[Signup Analytics] Token verification failed', {
        error: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code,
        meta: error.meta,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
        isNewUser,
      });

      // Clear session cookie on verification failure
      res.clearCookie('ss_session', { path: '/' });
      
      // Log the full error for debugging
      console.error('[Signup Analytics] Full error object:', error);
      
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
