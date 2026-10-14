import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as BearerStrategy } from 'passport-http-bearer';
import { SupabaseService } from '../supabase.service';
import { User } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(
  BearerStrategy,
  'supabase-jwt',
) {
  private readonly logger = new Logger(SupabaseJwtStrategy.name);

  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async validate(token: string): Promise<User> {
    try {
      if (!token) {
        throw new UnauthorizedException('No token provided');
      }

      const supabaseUser = await this.supabaseService.verifyToken(token);
      const user = await this.supabaseService.getOrCreateUser(supabaseUser, token);
      // PLAT-02: a report names the account by its id only (see redactEvent).
      Sentry.setUser({ id: user.id });
      return user;
    } catch (error) {
      this.logger.warn(`Token validation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw new UnauthorizedException('Token validation failed');
    }
  }
}
