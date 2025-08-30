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
import { RegisterDto } from './dto/auth.dto';
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
      throw new UnauthorizedException('Refresh token not found');
    }

    const tokens = await this.authService.refreshTokens(refreshToken);

    this.setTokenCookie(response, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
    };
  }

  private setTokenCookie(response: Response, token: string) {
    response.cookie('refresh_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  private clearTokenCookie(response: Response) {
    response.clearCookie('refresh_token');
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
