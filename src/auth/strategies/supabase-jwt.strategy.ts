import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { SupabaseService } from '../supabase.service';
import { User } from '@prisma/client';

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(
  Strategy,
  'supabase-jwt',
) {
  constructor(private supabaseService: SupabaseService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Use a dummy secret since we verify with Supabase directly
      secretOrKey: 'dummy-secret',
      // Pass the request to validate method
      passReqToCallback: true,
    });
  }

  async validate(request: any, payload: any): Promise<User> {
    try {
      // Extract the token from the request
      const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);

      if (!token) {
        throw new UnauthorizedException('No token provided');
      }

      // Verify the token with Supabase and extract user info
      const supabaseUser = await this.supabaseService.verifyToken(token);

      // Get or create user in our database
      const user = await this.supabaseService.getOrCreateUser(supabaseUser);

      return user;
    } catch (error) {
      throw new UnauthorizedException('Token validation failed');
    }
  }
}
