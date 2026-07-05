import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Post,
  Request,
  Response,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import * as bcrypt from 'bcrypt';
import type {
  SupabaseAuthResponse,
  SupabaseMigrationResponse,
} from '@sunsteel/contracts';
import { SupabaseService } from './supabase.service';
import { SupabaseJwtGuard } from './guards/supabase-jwt.guard';
import { DatabaseService } from '../database/database.service';
import { SupabaseMigrationDto, SupabaseVerifyTokenDto } from './dto/auth.dto';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

type SupabaseRequestUser = SupabaseAuthResponse['user'];
type AuthenticatedSupabaseRequest = ExpressRequest & {
  user: SupabaseRequestUser;
};

@Controller('auth/supabase')
export class SupabaseAuthController {
  private readonly logger = new Logger(SupabaseAuthController.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Verify Supabase token and return user profile.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyToken(
    @Body() { token }: SupabaseVerifyTokenDto,
    @Response({ passthrough: true }) res: ExpressResponse,
  ): Promise<SupabaseAuthResponse> {
    const startTime = Date.now();
    let isNewUser = false;

    try {
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
        secure: this.configService.get<string>('NODE_ENV') === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      const duration = Date.now() - startTime;
      this.logger.log(
        `[Signup Analytics] verification succeeded (${isNewUser ? 'new' : 'existing'} user) in ${duration}ms`,
      );

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
      this.logger.warn(
        `[Signup Analytics] verification failed in ${duration}ms (${isNewUser ? 'new' : 'existing'} user path): ${getErrorMessage(error)}`,
      );

      // Clear session cookie on verification failure
      res.clearCookie('ss_session', { path: '/' });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to verify token');
    }
  }

  /**
   * Get user profile using Supabase JWT.
   */
  @Get('profile')
  @UseGuards(SupabaseJwtGuard)
  async getProfile(
    @Request() req: AuthenticatedSupabaseRequest,
  ): Promise<SupabaseAuthResponse> {
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
   * Clear session cookie on logout.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Response({ passthrough: true }) res: ExpressResponse) {
    res.clearCookie('ss_session', { path: '/' });
    return { message: 'Logged out successfully' };
  }

  /**
   * Migration endpoint for existing users.
   */
  @Post('migrate')
  async migrateUser(
    @Body() { email, password }: SupabaseMigrationDto,
  ): Promise<SupabaseMigrationResponse> {
    const user = await this.databaseService.user.findUnique({
      where: { email },
    });

    if (!user?.password) {
      throw new BadRequestException('Invalid migration credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new BadRequestException('Invalid migration credentials');
    }

    return {
      message: 'User validated for migration',
      userId: user.id,
      email: user.email,
    };
  }

  /**
   * Health check endpoint.
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
