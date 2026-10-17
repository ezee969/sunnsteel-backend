import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { apiError, type FeatureKey } from '@sunsteel/contracts';
import type { RequestWithUser } from '../common/types/request-with-user';
import { EntitlementsService } from './entitlements.service';

export const REQUIRED_ENTITLEMENT = 'billing:requiredEntitlement';

/**
 * BILL-01: the server's gate on a capability. It runs after the controller's
 * `SupabaseJwtGuard` (method guards follow class guards) and asks
 * `EntitlementsService` per request, so a revoked grant stops access on the
 * next request rather than at the token's expiry.
 *
 * A refusal is **403 `ENTITLEMENT_REQUIRED`**, unlike the moderator's 404:
 * what Pro offers is public, so confirming the route exists hides nothing.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(
      REQUIRED_ENTITLEMENT,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) return true;
    const userId = context.switchToHttp().getRequest<RequestWithUser>().user?.id;
    if (!userId) throw new NotFoundException('Not found');
    if (await this.entitlements.can(userId, feature)) return true;
    throw new ForbiddenException(apiError('ENTITLEMENT_REQUIRED'));
  }
}

/**
 * Names the capability a route needs and applies the guard with it, so a
 * route can never carry the requirement without the check. The module that
 * declares the route imports `BillingModule`.
 */
export function RequiresEntitlement(feature: FeatureKey) {
  return applyDecorators(
    SetMetadata(REQUIRED_ENTITLEMENT, feature),
    UseGuards(EntitlementGuard),
  );
}
