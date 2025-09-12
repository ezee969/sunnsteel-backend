import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createClient,
  SupabaseClient,
  User as SupabaseUser,
} from '@supabase/supabase-js';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor(private databaseService: DatabaseService) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  /**
   * Verify a Supabase JWT token and return the user info
   */
  async verifyToken(token: string): Promise<SupabaseUser> {
    try {
      const { data, error } = await this.supabase.auth.getUser(token);

      if (error || !data.user) {
        throw new UnauthorizedException('Invalid token');
      }

      return data.user;
    } catch (error) {
      throw new UnauthorizedException('Token verification failed');
    }
  }

  /**
   * Get or create user in our database based on Supabase user
   */
  async getOrCreateUser(supabaseUser: SupabaseUser) {
    // First, try to find user by supabaseUserId
    let user = await this.databaseService.user.findUnique({
      where: { supabaseUserId: supabaseUser.id },
    });

    if (user) {
      return user;
    }

    // If not found by supabaseUserId, try to find by email (for migration)
    user = await this.databaseService.user.findUnique({
      where: { email: supabaseUser.email },
    });

    if (user) {
      // Link existing user to Supabase
      return this.databaseService.user.update({
        where: { id: user.id },
        data: { supabaseUserId: supabaseUser.id },
      });
    }

    // Create new user if not found
    return this.databaseService.user.create({
      data: {
        email: supabaseUser.email!,
        name:
          supabaseUser.user_metadata?.name || supabaseUser.email!.split('@')[0],
        supabaseUserId: supabaseUser.id,
      },
    });
  }

  /**
   * Get user from our database using Supabase user ID
   */
  async getUserBySupabaseId(supabaseUserId: string) {
    return this.databaseService.user.findUnique({
      where: { supabaseUserId },
    });
  }
}
