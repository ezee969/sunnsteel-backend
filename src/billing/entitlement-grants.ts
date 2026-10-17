import { Prisma } from '@prisma/client';
import type { EntitlementGrant, EntitlementSource, PrismaClient } from '@prisma/client';
import {
  isPlanId,
  type EntitlementGrantSummary,
  type GrantWindow,
  type PlanId,
} from '@sunsteel/contracts';

/**
 * BILL-01: writing grants. Both `EntitlementsService` and the
 * `db:grant:plan` script go through these two functions, so a grant given by
 * hand obeys exactly the rule a grant given by the product will.
 *
 * The rule: **at most one unrevoked grant per member and source**, held by the
 * partial unique index `EntitlementGrant_one_open_per_source`. A new grant
 * revokes that source's last one and is inserted in the same transaction, so
 * a member never holds two ADMIN grants that disagree. Two grants racing each
 * other cannot both stand: the second insert meets the index, and the retry
 * revokes the first and inserts again, so the last writer wins whole.
 */

/** How many times a grant that lost a race is tried again. */
export const GRANT_CONFLICT_RETRIES = 3;

type GrantDb = Pick<PrismaClient, '$transaction'>;

export interface GrantPlanRequest {
  userId: string;
  planId: PlanId;
  source: EntitlementSource;
  /** Null for a grant that never expires. */
  expiresAt: Date | null;
  note?: string | null;
  subscriptionId?: string | null;
}

/** Whether an error is the open-grant index refusing a second open grant. */
export function isOpenGrantConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/** A grant that would already be over when it starts is refused. */
export function grantProblem(
  request: Pick<GrantPlanRequest, 'expiresAt'>,
  now: Date,
): string | null {
  if (request.expiresAt !== null && request.expiresAt.getTime() <= now.getTime()) {
    return 'A grant must expire after it starts';
  }
  return null;
}

/**
 * Grants a plan from a source, replacing that source's open grant. The grant
 * starts now; access changes with the commit, because the plan is computed
 * from the grants on every read.
 */
export async function grantPlan(
  db: GrantDb,
  request: GrantPlanRequest,
  clock: () => Date = () => new Date(),
): Promise<EntitlementGrant> {
  for (let attempt = 0; ; attempt += 1) {
    const now = clock();
    const problem = grantProblem(request, now);
    if (problem) throw new Error(problem);
    try {
      return await db.$transaction(async (tx) => {
        await tx.entitlementGrant.updateMany({
          where: { userId: request.userId, source: request.source, revokedAt: null },
          data: { revokedAt: now },
        });
        return tx.entitlementGrant.create({
          data: {
            userId: request.userId,
            planId: request.planId,
            source: request.source,
            subscriptionId: request.subscriptionId ?? null,
            startsAt: now,
            expiresAt: request.expiresAt,
            note: request.note ?? null,
          },
        });
      });
    } catch (error) {
      if (isOpenGrantConflict(error) && attempt < GRANT_CONFLICT_RETRIES) continue;
      throw error;
    }
  }
}

/**
 * Revokes a member's open grants -- one source's, or every source's when none
 * is named -- and answers how many it revoked. Revoking is never a delete:
 * the grant stays as the record of what the member had.
 */
export async function revokePlan(
  db: Pick<PrismaClient, 'entitlementGrant'>,
  userId: string,
  source: EntitlementSource | null,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await db.entitlementGrant.updateMany({
    where: { userId, revokedAt: null, ...(source ? { source } : {}) },
    data: { revokedAt: now },
  });
  return count;
}

/** A stored grant as the plan rule reads it; an unknown plan counts as none. */
export function grantWindow(grant: {
  planId: string;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}): GrantWindow | null {
  if (!isPlanId(grant.planId)) return null;
  return {
    planId: grant.planId,
    startsAt: grant.startsAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
  };
}

export function grantWindows(
  grants: readonly Parameters<typeof grantWindow>[0][],
): GrantWindow[] {
  return grants.flatMap((grant) => {
    const window = grantWindow(grant);
    return window ? [window] : [];
  });
}

/** The grants in force, the one that lasts longest first (never-ending first). */
export function grantSummaries(
  grants: readonly EntitlementGrant[],
): EntitlementGrantSummary[] {
  return grants
    .flatMap((grant) =>
      isPlanId(grant.planId) ? [{ ...grant, planId: grant.planId }] : [],
    )
    .sort((a, b) => {
      const end = (g: { expiresAt: Date | null }) =>
        g.expiresAt === null ? Number.POSITIVE_INFINITY : g.expiresAt.getTime();
      return end(b) - end(a) || a.id.localeCompare(b.id);
    })
    .map((grant) => ({
      id: grant.id,
      planId: grant.planId,
      source: grant.source,
      startsAt: grant.startsAt.toISOString(),
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      note: grant.note,
    }));
}
