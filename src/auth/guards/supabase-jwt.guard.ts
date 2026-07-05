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

  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    _info: unknown,
    context: ExecutionContext,
    _status?: unknown,
  ): TUser {
    void _status;
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication required');
    }

    // Ensure request.user is set and return the user provided by Passport
    const request = context.switchToHttp().getRequest<{ user?: TUser }>();
    if (!request.user) {
      request.user = user;
    }

    return user;
  }
}
