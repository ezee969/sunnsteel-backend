import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ExecutionContext } from '@nestjs/common';
import { TokenService } from 'src/token/token.service';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly tokenService: TokenService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    // Check if tokenService is available before using it
    if (this.tokenService) {
      const isBlacklisted = await this.tokenService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    return super.canActivate(context) as Promise<boolean>;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authorizationHeader = request.headers.authorization;

    if (!authorizationHeader) {
      return undefined;
    }

    const [type, token] = authorizationHeader.split(' ');

    return type === 'Bearer' ? token : undefined;
  }
}
