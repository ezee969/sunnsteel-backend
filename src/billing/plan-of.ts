import { ForbiddenException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  apiError,
  listWithinLimit,
  PLANS,
  planFromGrants,
  planIncludes,
  type FeatureKey,
  type PlanId,
  type PlanLimitKey,
} from '@sunsteel/contracts';
import { grantWindows } from './entitlement-grants';

/**
 * BILL-02: the plan checks a service makes inside its own work -- a range, a
 * count, a new block in a routine edit -- where a route guard cannot see the
 * request's meaning. Like `hiddenFromViewer`, they take the caller's own `db`
 * rather than an injected service, so a module's wiring can never make a
 * check fail open, and inside a transaction they read with it.
 */
export type PlanDb = Pick<PrismaClient, 'entitlementGrant'>;

export async function planOf(
  db: PlanDb,
  userId: string,
  now: Date = new Date(),
): Promise<PlanId> {
  const grants = await db.entitlementGrant.findMany({
    where: {
      userId,
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { planId: true, startsAt: true, expiresAt: true, revokedAt: true },
  });
  return planFromGrants(grantWindows(grants), now);
}

export function entitlementRequired(): ForbiddenException {
  return new ForbiddenException(apiError('ENTITLEMENT_REQUIRED'));
}

export function planLimitReached(max: number): ForbiddenException {
  return new ForbiddenException(apiError('PLAN_LIMIT_REACHED', { max }));
}

/** Refuses with 403 `ENTITLEMENT_REQUIRED` unless the plan unlocks it. */
export async function assertFeature(
  db: PlanDb,
  userId: string,
  feature: FeatureKey,
): Promise<void> {
  if (!planIncludes(await planOf(db, userId), feature)) throw entitlementRequired();
}

export async function limitOf(
  db: PlanDb,
  userId: string,
  key: PlanLimitKey,
): Promise<number | null> {
  return PLANS[await planOf(db, userId)].limits[key];
}

/** A count that may not pass the plan's limit, such as a routine's versions. */
export function assertBelowLimit(limit: number | null, count: number): void {
  if (limit !== null && count >= limit) throw planLimitReached(limit);
}

/**
 * A replace-the-whole-list write (goals, training locations): past the limit
 * it may keep, edit or drop stored items but add none (contracts'
 * `listWithinLimit`).
 */
export function assertListWithinLimit(
  limit: number | null,
  requestedIds: readonly (string | null | undefined)[],
  storedIds: readonly string[],
): void {
  if (limit !== null && !listWithinLimit(limit, requestedIds, storedIds)) {
    throw planLimitReached(limit);
  }
}
