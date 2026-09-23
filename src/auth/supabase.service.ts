import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { createInitialUsername } from '../users/username';
import {
  identityFromClaims,
  SupabaseIdentity,
  supabaseIssuer,
} from './access-token-claims';

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
  private readonly issuer: string;

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
    this.issuer = supabaseIssuer(supabaseUrl);
  }

  /**
   * Verify a Supabase access token locally and return who it belongs to.
   *
   * TD-43: this runs on every protected request, so it must not call Supabase
   * Auth. `getClaims` checks the signature against the project's JWKS, which
   * supabase-js fetches once and keeps for ten minutes (a token with a key id
   * it has not seen refetches it, so a rotated key keeps working). Only a
   * symmetric (HS*) token, which this project no longer issues, still falls
   * back to the remote `getUser` inside `getClaims`.
   *
   * The trade-off, accepted with TD-43: a token stays usable until its `exp`
   * (an hour) after the session behind it ends, where `getUser` refused it at
   * once. Nothing here relies on immediate revocation: no product control
   * suspends a member through Supabase.
   */
  async verifyToken(token: string): Promise<SupabaseIdentity> {
    try {
      const { data, error } = await this.supabase.auth.getClaims(token);

      if (error || !data) {
        throw new UnauthorizedException('Invalid token');
      }

      return identityFromClaims(data.claims, this.issuer);
    } catch {
      // Malformed and expired tokens throw from inside getClaims rather than
      // returning an error; every failure is the same 401.
      throw new UnauthorizedException('Token verification failed');
    }
  }

  /**
   * Get or create user in our database based on Supabase user.
   *
   * The steady state is one indexed lookup by `supabaseUserId`. The email is
   * the one in the token, so a changed address reaches this row when the
   * client next refreshes its token rather than on the next request.
   */
  async getOrCreateUser(supabaseUser: SupabaseIdentity) {
    const metadataName = (key: string) => {
      const value = supabaseUser.user_metadata[key];
      return typeof value === 'string' ? value : undefined;
    };
    const userName =
      metadataName('name') ||
      metadataName('full_name') ||
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
          username: createInitialUsername(userName, supabaseUser.id),
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
