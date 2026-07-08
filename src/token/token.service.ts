// Utilities
import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
// Services
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
// Types
import { Tokens } from './types/tokens.type';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { randomUUID } from 'crypto';

@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private db: DatabaseService,
    private configService: ConfigService,
  ) {}

  private getAccessSecret(): string {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new InternalServerErrorException('JWT access secret is not configured');
    }
    return secret;
  }

  private getRefreshSecret(): string {
    const secret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!secret) {
      throw new InternalServerErrorException(
        'JWT refresh secret is not configured',
      );
    }
    return secret;
  }

  async generateTokens(userId: string, email: string): Promise<Tokens> {
    const accessSecret = this.getAccessSecret();
    const refreshSecret = this.getRefreshSecret();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
        },
        {
          secret: accessSecret,
          expiresIn: '15m',
        },
      ),
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
          jti: randomUUID(),
        },
        {
          secret: refreshSecret,
          expiresIn: '7d',
        },
      ),
    ]);

    // Store refresh token in database
    await this.storeRefreshToken(refreshToken, userId);

    return {
      accessToken,
      refreshToken,
    };
  }

  private async storeRefreshToken(
    token: string,
    userId: string,
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    // Delete any existing tokens for this user to avoid duplicates
    await this.db.refreshToken.deleteMany({
      where: { userId },
    });

    // Verify user exists before creating refresh token
    const userExists = await this.db.user.findUnique({
      where: { id: userId },
    });
    if (!userExists) {
      throw new InternalServerErrorException(
        `Cannot create refresh token for non-existent user: ${userId}`,
      );
    }

    try {
      await this.db.refreshToken.create({
        data: {
          token,
          userId,
          expiresAt,
        },
      });
    } catch (err: unknown) {
      // Handle race condition where the same refresh token was created concurrently
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: unknown }).code === 'P2002'
      ) {
        // Token already exists; safe to ignore as it belongs to this user/session
        return;
      }
      throw err;
    }
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await this.db.refreshToken.delete({
      where: {
        token,
      },
    });
  }

  async verifyRefreshToken(token: string) {
    try {
      // Verify token existence and expiration in database
      const storedToken = await this.db.refreshToken.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!storedToken) {
        throw new UnauthorizedException('Refresh token not found');
      }

      if (storedToken.expiresAt < new Date()) {
        // Remove expired token
        await this.revokeRefreshToken(token);
        throw new UnauthorizedException('Refresh token expired');
      }

      // Verify JWT
      const refreshSecret = this.getRefreshSecret();
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: refreshSecret,
      });

      // Verify token belongs to correct user
      if (storedToken.userId !== payload.sub) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return {
        sub: payload.sub,
        email: payload.email,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.db.refreshToken.deleteMany({
      where: {
        userId,
      },
    });
  }

  async blacklistAccessToken(token: string): Promise<void> {
    const decoded: JwtPayload = this.jwtService.decode(token);

    if (!decoded || !decoded['exp']) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const expiresAt = new Date(decoded['exp'] * 1000);

    await this.db.blacklistedToken.create({
      data: {
        token,
        expiresAt,
      },
    });
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const blacklistedToken = await this.db.blacklistedToken.findUnique({
      where: { token },
    });

    return !!blacklistedToken;
  }

  // Add cleanup method for expired blacklisted tokens
  async cleanupBlacklistedTokens(): Promise<void> {
    await this.db.blacklistedToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleTokenCleanup() {
    await this.cleanupBlacklistedTokens();
  }
}
