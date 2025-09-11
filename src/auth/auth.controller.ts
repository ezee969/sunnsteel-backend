import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Res,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto, GoogleAuthDto } from './dto/auth.dto';
import { PassportLocalGuard } from './guards/passport-local.guard';
import { JwtAuthGuard } from './guards/passport-jwt.guard';
import { RequestWithUserIdentification } from './types/request-with-user-indentification.type';
import { RequestWithJwt } from './types/request-with-jwt.type';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(registerDto);

    this.setTokenCookie(response, result.tokens.refreshToken);
    this.setSessionCookie(response);

    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
    };
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleLogin(
    @Body() body: GoogleAuthDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { idToken } = body;
    const result = await this.authService.loginWithGoogle(idToken);

    this.setTokenCookie(response, result.tokens.refreshToken);
    this.setSessionCookie(response);

    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
    };
  }

  @UseGuards(PassportLocalGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() request: RequestWithUserIdentification,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user } = request;

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const result = await this.authService.login(user);

    this.setTokenCookie(response, result.tokens.refreshToken);
    this.setSessionCookie(response);

    return {
      user: result.user,
      accessToken: result.tokens.accessToken,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: RequestWithJwt,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.refresh_token;
    const accessToken = this.extractTokenFromHeader(request);

    if (refreshToken && accessToken) {
      await this.authService.logout(refreshToken, accessToken);
    }

    this.clearTokenCookie(response);
    this.clearSessionCookie(response);
    return { message: 'Logged out successfully' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: RequestWithJwt,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.refresh_token;

    if (!refreshToken) {
      // Proactively clear any session markers to prevent redirect loops
      this.clearTokenCookie(response);
      this.clearSessionCookie(response);
      throw new UnauthorizedException('Refresh token not found');
    }

    try {
      const tokens = await this.authService.refreshTokens(refreshToken);

      this.setTokenCookie(response, tokens.refreshToken);
      this.setSessionCookie(response);

      return {
        accessToken: tokens.accessToken,
      };
    } catch {
      // On invalid/expired refresh tokens, clear cookies to break client-side loops
      this.clearTokenCookie(response);
      this.clearSessionCookie(response);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private setTokenCookie(response: Response, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    response.cookie('refresh_token', token, {
      httpOnly: true,
      secure: isProd,
      // Cross-site cookie for Vercel (frontend) → Railway (backend)
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  private setSessionCookie(response: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    response.cookie('has_session', 'true', {
      httpOnly: false,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (mirror refresh cookie)
    });
  }

  private clearTokenCookie(response: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    response.clearCookie('refresh_token', {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
    });
  }

  private clearSessionCookie(response: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    response.clearCookie('has_session', {
      httpOnly: false,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
    });
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
