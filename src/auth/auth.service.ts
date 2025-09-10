import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { TokenService } from '../token/token.service';
import { RegisterDto } from './dto/auth.dto';
import * as bcrypt from 'bcrypt';
import { UserIdentification } from './types/user-identification.type';
import { OAuth2Client } from 'google-auth-library';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {}

  private googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  async register(registerDto: RegisterDto) {
    const { email, password, name } = registerDto;

    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const user = await this.usersService.create({
      email,
      password,
      name,
    });

    const tokens = await this.tokenService.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      tokens,
    };
  }

  async validateUser(
    email: string,
    password: string,
  ): Promise<UserIdentification | null> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }

  async login(user: UserIdentification) {
    const tokens = await this.tokenService.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      tokens,
    };
  }

  /**
   * Google Sign-In via ID token verification
   */
  async loginWithGoogle(idToken: string) {
    if (!idToken) {
      throw new UnauthorizedException('Missing Google ID token');
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new UnauthorizedException('Google client not configured');
    }

    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      throw new UnauthorizedException('Invalid Google token');
    }
    const email = payload.email as string | undefined;
    const emailVerified = Boolean(payload.email_verified);
    const name =
      (payload.name as string | undefined) ?? (email ? email.split('@')[0] : 'User');

    if (!email || !emailVerified) {
      throw new UnauthorizedException('Email not verified by Google');
    }

    let user = await this.usersService.findByEmail(email);
    if (!user) {
      // Create a new user with a random password (not used for Google accounts)
      const randomPassword = crypto.randomBytes(32).toString('hex');
      user = await this.usersService.create({
        email,
        password: randomPassword,
        name,
      });
    }

    const tokens = await this.tokenService.generateTokens(user.id, user.email);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      tokens,
    };
  }

  async logout(refreshToken: string, accessToken: string) {
    // Revoke refresh token
    await this.tokenService.revokeRefreshToken(refreshToken);

    // Blacklist access token
    await this.tokenService.blacklistAccessToken(accessToken);
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = await this.tokenService.verifyRefreshToken(refreshToken);
      const user = await this.usersService.findByEmail(payload.email);

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      return this.tokenService.generateTokens(user.id, user.email);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
