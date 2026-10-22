import { Injectable } from '@nestjs/common';
import type { EntitlementGrant } from '@prisma/client';
import {
  PLANS,
  planFromGrants,
  planIncludes,
  type BillingStatus,
  type FeatureKey,
  type PlanId,
  type PlanLimitKey,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import {
  grantPlan,
  grantSummaries,
  grantWindows,
  revokePlan,
  type GrantPlanRequest,
} from './entitlement-grants';
import { planOf } from './plan-of';

/**
 * BILL-01: the one place that decides what an account may do. Nothing is
 * cached -- the plan is computed from the grants in force on every call, so a
 * grant that begins, expires or is revoked changes access at that moment.
 * `BILL-02` gates capabilities through `can` and `limit`; until then nothing
 * calls them on a route, and every account keeps everything it has.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly db: DatabaseService) {}

  private grantsInForce(userId: string, now: Date): Promise<EntitlementGrant[]> {
    return this.db.entitlementGrant.findMany({
      where: {
        userId,
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  }

  planFor(userId: string, now: Date = new Date()): Promise<PlanId> {
    return planOf(this.db, userId, now);
  }

  /** Whether the account's plan unlocks a capability now. */
  async can(userId: string, feature: FeatureKey): Promise<boolean> {
    return planIncludes(await this.planFor(userId), feature);
  }

  /** The account's limit for a counted capability, or null for none. */
  async limit(userId: string, key: PlanLimitKey): Promise<number | null> {
    return PLANS[await this.planFor(userId)].limits[key];
  }

  /** `GET /billing/me`. */
  async status(userId: string): Promise<BillingStatus> {
    const now = new Date();
    const grants = await this.grantsInForce(userId, now);
    const plan = planFromGrants(grantWindows(grants), now);
    return {
      plan,
      features: [...PLANS[plan].features],
      limits: { ...PLANS[plan].limits },
      grants: grantSummaries(grants),
    };
  }

  grant(request: GrantPlanRequest): Promise<EntitlementGrant> {
    return grantPlan(this.db, request);
  }

  revoke(userId: string, source: GrantPlanRequest['source'] | null): Promise<number> {
    return revokePlan(this.db, userId, source);
  }
}
