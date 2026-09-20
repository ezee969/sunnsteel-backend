import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestWithUser } from '../common/types/request-with-user';
import { DatabaseService } from '../database/database.service';

/**
 * TRUST-04's whole authorization model: one boolean on the account. There is
 * one moderator, so a roles table would be a subsystem built for a second one
 * who does not exist.
 *
 * A non-moderator gets **404, not 403**, for the reason `PROF-10` and
 * `ROUT-04` both give: a refusal that confirms the route exists tells an
 * account exactly what to go looking for. The queue is indistinguishable from
 * a route that was never built.
 *
 * It reads the flag per request rather than trusting anything on the token.
 * The flag is not a Supabase claim, and a session minted before it was removed
 * must not keep working after.
 */
@Injectable()
export class ModeratorGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const viewerId = request.user?.id;
    if (!viewerId) throw new NotFoundException('Not found');
    const account = await this.db.user.findUnique({
      where: { id: viewerId },
      select: { isModerator: true },
    });
    if (!account?.isModerator) throw new NotFoundException('Not found');
    return true;
  }
}
