// Utilities
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
// Services
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from 'src/database/database.service';
// Types
import { Tokens } from './types/tokens.type';
import { JwtPayload } from 'src/auth/types/jwt-payload.type';

@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private db: DatabaseService,
  ) {}

  async generateTokens(userId: string, email: string): Promise<Tokens> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
        },
        {
          secret: process.env.JWT_ACCESS_SECRET,
          expiresIn: '15m',
        },
      ),
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
        },
        {
          secret: process.env.JWT_REFRESH_SECRET,
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

    await this.db.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });
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
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: process.env.JWT_REFRESH_SECRET,
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
      throw new Error('Invalid token payload');
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
