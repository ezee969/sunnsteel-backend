import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { ExecutionContext } from '@nestjs/common';

@Injectable()
export class SupabaseJwtGuard extends AuthGuard('supabase-jwt') {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication required');
    }

    // The user is already set in the request by the strategy
    const request = context.switchToHttp().getRequest();
    if (!request.user) {
      throw new UnauthorizedException('User not found');
    }

    return request.user;
  }
}
