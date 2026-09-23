import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Post,
} from '@nestjs/common';
import type { SupabaseAuthResponse } from '@sunsteel/contracts';
import { SupabaseService } from './supabase.service';
import { SupabaseVerifyTokenDto } from './dto/auth.dto';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Supabase is the whole of authentication. What used to sit beside it — a
 * password migration endpoint, a profile read and a cookie this service set —
 * was removed in TD-47; see that entry for what each one was and why none of
 * them was load-bearing.
 *
 * The `ss_session` marker the frontend middleware reads is **the frontend's**,
 * set by its own same-origin `/api/session` route. A cookie in this service's
 * response is scoped to this service's domain, which is a third party to the
 * app, so it was never sent back and middleware never saw it. Do not add one
 * here again.
 */
@Controller('auth/supabase')
export class SupabaseAuthController {
  private readonly logger = new Logger(SupabaseAuthController.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Verify a Supabase token and return the user, creating them on first sight.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyToken(
    @Body() { token }: SupabaseVerifyTokenDto,
  ): Promise<SupabaseAuthResponse> {
    const startTime = Date.now();
    let isNewUser = false;

    try {
      const supabaseUser = await this.supabaseService.verifyToken(token);

      // Read before getOrCreate, so the log below can say which path this was.
      const existingUser = await this.supabaseService.getUserBySupabaseId(
        supabaseUser.id,
      );
      isNewUser = !existingUser;

      const user = await this.supabaseService.getOrCreateUser(supabaseUser, token);

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

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to verify token');
    }
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
