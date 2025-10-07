import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createClient,
  SupabaseClient,
  User as SupabaseUser,
} from '@supabase/supabase-js';
import { Prisma } from '@prisma/client';
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
   * Uses upsert to prevent race conditions during concurrent requests
   */
  async getOrCreateUser(supabaseUser: SupabaseUser) {
    console.log('[getOrCreateUser] Starting with Supabase user:', {
      id: supabaseUser.id,
      email: supabaseUser.email,
      hasUserMetadata: !!supabaseUser.user_metadata,
      userMetadata: supabaseUser.user_metadata,
      name: supabaseUser.user_metadata?.name,
    });

    // Extract name with multiple fallbacks
    const userName =
      supabaseUser.user_metadata?.name ||
      supabaseUser.user_metadata?.full_name ||
      supabaseUser.email?.split('@')[0] ||
      'User';

    console.log('[getOrCreateUser] Extracted userName:', userName);

    // First, check if user already exists by supabaseUserId
    const existingUserBySupabaseId = await this.databaseService.user.findUnique({
      where: { supabaseUserId: supabaseUser.id },
    });

    if (existingUserBySupabaseId) {
      console.log('[getOrCreateUser] User found by supabaseUserId, updating if needed');
      
      // Update user data if needed
      const updateData: { email: string; name?: string } = {
        email: supabaseUser.email!,
      };
      
      // Only update name if it's not just the email prefix (preserve user-provided names)
      if (userName !== supabaseUser.email?.split('@')[0]) {
        updateData.name = userName;
      }

      return this.databaseService.user.update({
        where: { id: existingUserBySupabaseId.id },
        data: updateData,
      });
    }

    // Check if user exists by email (legacy user migration scenario)
    const existingUserByEmail = await this.databaseService.user.findUnique({
      where: { email: supabaseUser.email },
    });

    if (existingUserByEmail) {
      if (!existingUserByEmail.supabaseUserId) {
        // Link existing legacy user to Supabase
        console.log('[getOrCreateUser] Linking existing legacy user to Supabase');
        
        const updateData: { supabaseUserId: string; name?: string } = {
          supabaseUserId: supabaseUser.id,
        };
        
        // Only update name if it's not just the email prefix (preserve user-provided names)
        if (userName !== supabaseUser.email?.split('@')[0]) {
          updateData.name = userName;
        }

        return this.databaseService.user.update({
          where: { id: existingUserByEmail.id },
          data: updateData,
        });
      } else if (existingUserByEmail.supabaseUserId === supabaseUser.id) {
        // User already exists with correct supabaseUserId - just return it
        console.log('[getOrCreateUser] User already exists with correct supabaseUserId, returning existing user');
        return existingUserByEmail;
      } else {
        // User exists with different supabaseUserId - this is a conflict
        console.error('[getOrCreateUser] User exists with different supabaseUserId:', {
          existingSupabaseUserId: existingUserByEmail.supabaseUserId,
          newSupabaseUserId: supabaseUser.id,
          email: supabaseUser.email,
        });
        throw new Error(
          `User with email ${supabaseUser.email} already exists with different Supabase ID`,
        );
      }
    }

    // Create new user
    console.log('[getOrCreateUser] Creating new user');
    try {
      const user = await this.databaseService.user.create({
        data: {
          email: supabaseUser.email!,
          name: userName,
          supabaseUserId: supabaseUser.id,
        },
      });

      console.log('[getOrCreateUser] User created successfully:', {
        userId: user.id,
        email: user.email,
        name: user.name,
      });

      return user;
    } catch (error) {
      console.error('[getOrCreateUser] Failed to create user:', {
        error: error.message,
        code: (error as Prisma.PrismaClientKnownRequestError)?.code,
        meta: (error as Prisma.PrismaClientKnownRequestError)?.meta,
        supabaseUserId: supabaseUser.id,
        email: supabaseUser.email,
      });

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        error.meta?.target.includes('email')
      ) {
        console.log('[getOrCreateUser] Unique constraint on email hit, returning existing user');
        const existingUser = await this.databaseService.user.findUnique({
          where: { email: supabaseUser.email! },
        });

        if (existingUser) {
          // Ensure Supabase ID is linked
          if (!existingUser.supabaseUserId) {
            return this.databaseService.user.update({
              where: { id: existingUser.id },
              data: {
                supabaseUserId: supabaseUser.id,
                ...(userName !== supabaseUser.email?.split('@')[0] && {
                  name: userName,
                }),
              },
            });
          }

          return existingUser;
        }
      }

      throw new Error(
        `Failed to create user: ${error.message}. Supabase user ID: ${supabaseUser.id}, Email: ${supabaseUser.email}`,
      );
    }
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
