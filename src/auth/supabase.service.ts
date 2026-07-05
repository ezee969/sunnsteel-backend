import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  SupabaseClient,
  User as SupabaseUser,
} from '@supabase/supabase-js';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';

function isUniqueEmailViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    Array.isArray(error.meta?.target) &&
    error.meta.target.includes('email')
  );
}

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new InternalServerErrorException('Missing Supabase configuration');
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  /**
   * Verify a Supabase JWT token and return the user info.
   */
  async verifyToken(token: string): Promise<SupabaseUser> {
    try {
      const { data, error } = await this.supabase.auth.getUser(token);

      if (error || !data.user) {
        throw new UnauthorizedException('Invalid token');
      }

      return data.user;
    } catch {
      throw new UnauthorizedException('Token verification failed');
    }
  }

  /**
   * Get or create user in our database based on Supabase user.
   */
  async getOrCreateUser(supabaseUser: SupabaseUser) {
    const userName =
      supabaseUser.user_metadata?.name ||
      supabaseUser.user_metadata?.full_name ||
      supabaseUser.email?.split('@')[0] ||
      'User';

    const existingBySupabaseId = await this.databaseService.user.findUnique({
      where: { supabaseUserId: supabaseUser.id },
    });

    if (existingBySupabaseId) {
      if (existingBySupabaseId.email !== supabaseUser.email) {
        return this.databaseService.user.update({
          where: { id: existingBySupabaseId.id },
          data: { email: supabaseUser.email! },
        });
      }
      return existingBySupabaseId;
    }

    const existingByEmail = await this.databaseService.user.findUnique({
      where: { email: supabaseUser.email },
    });

    if (existingByEmail) {
      if (!existingByEmail.supabaseUserId) {
        return this.databaseService.user.update({
          where: { id: existingByEmail.id },
          data: {
            supabaseUserId: supabaseUser.id,
          },
        });
      }

      if (existingByEmail.supabaseUserId === supabaseUser.id) {
        return existingByEmail;
      }

      throw new ConflictException('Account conflict for this email');
    }

    try {
      return await this.databaseService.user.create({
        data: {
          email: supabaseUser.email!,
          name: userName,
          supabaseUserId: supabaseUser.id,
        },
      });
    } catch (error) {
      if (isUniqueEmailViolation(error)) {
        const existing = await this.databaseService.user.findUnique({
          where: { email: supabaseUser.email! },
        });

        if (existing) {
          if (!existing.supabaseUserId) {
            return this.databaseService.user.update({
              where: { id: existing.id },
              data: { supabaseUserId: supabaseUser.id },
            });
          }

          if (existing.supabaseUserId === supabaseUser.id) {
            return existing;
          }

          throw new ConflictException('Account conflict for this email');
        }
      }

      this.logger.error(
        `Failed to synchronize user for ${supabaseUser.email}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new InternalServerErrorException('Failed to synchronize user account');
    }
  }

  /**
   * Get user from our database using Supabase user ID.
   */
  async getUserBySupabaseId(supabaseUserId: string) {
    return this.databaseService.user.findUnique({
      where: { supabaseUserId },
    });
  }
}
