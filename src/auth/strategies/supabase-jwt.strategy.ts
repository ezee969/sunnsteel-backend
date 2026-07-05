import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as BearerStrategy } from 'passport-http-bearer';
import { SupabaseService } from '../supabase.service';
import { User } from '@prisma/client';

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
      return this.supabaseService.getOrCreateUser(supabaseUser);
    } catch (error) {
      this.logger.warn(`Token validation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw new UnauthorizedException('Token validation failed');
    }
  }
}
