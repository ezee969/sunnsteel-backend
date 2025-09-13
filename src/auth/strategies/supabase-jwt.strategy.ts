import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as BearerStrategy } from 'passport-http-bearer';
import { SupabaseService } from '../supabase.service';
import { User } from '@prisma/client';

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(
  BearerStrategy,
  'supabase-jwt',
) {
  constructor(private supabaseService: SupabaseService) {
    super();
  }

  async validate(token: string): Promise<User> {
    try {
      console.log('🔐 SupabaseJwtStrategy(Bearer): Validating token', {
        hasToken: !!token,
        tokenLength: token?.length,
      });

      if (!token) {
        console.error('🔐 SupabaseJwtStrategy(Bearer): No token provided');
        throw new UnauthorizedException('No token provided');
      }

      // Verify the token directly with Supabase (not through our API)
      console.log('🔐 SupabaseJwtStrategy(Bearer): Verifying with Supabase...');
      const supabaseUser = await this.supabaseService.verifyToken(token);
      console.log(
        '🔐 SupabaseJwtStrategy(Bearer): Supabase verification successful',
        {
          userId: supabaseUser.id,
          email: supabaseUser.email,
        },
      );

      // Get or create user in our database
      console.log(
        '🔐 SupabaseJwtStrategy(Bearer): Getting/creating local user...',
      );
      const user = await this.supabaseService.getOrCreateUser(supabaseUser);
      console.log('🔐 SupabaseJwtStrategy(Bearer): Local user found/created', {
        userId: user.id,
        email: user.email,
      });

      return user;
    } catch (error) {
      console.error(
        '🔐 SupabaseJwtStrategy(Bearer): Token validation failed',
        error,
      );
      throw new UnauthorizedException('Token validation failed');
    }
  }
}
