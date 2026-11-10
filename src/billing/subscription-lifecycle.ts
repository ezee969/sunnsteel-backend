import { SUBSCRIPTION_GRACE_DAYS, type SubscriptionStatus } from '@sunsteel/contracts';
import { subscriptionGrantExpiry } from './checkout-rules';
import type { ProviderSubscription } from './payment-provider';

/**
 * BILL-04: the one rule for what a subscription becomes when the provider
 * is read -- at checkout, on a notification, in the daily reconciliation and
 * after a member cancels -- so none of those paths can disagree. Pure, so
 * every transition is tested without a database or a provider.
 *
 * The states are contracts' `SUBSCRIPTION_STATUSES`:
 *
 * - **TRIALING** while the free trial runs, **ACTIVE** once charged.
 * - **PAST_DUE** from the first read that finds a renewal failing: Pro stays
 *   for `SUBSCRIPTION_GRACE_DAYS` from that moment while the provider retries,
 *   and a successful retry returns it to ACTIVE.
 * - **CANCELED** once the member or the provider cancelled: nothing renews,
 *   and Pro lasts to the end of what was paid (or of the grace period, when
 *   it was past due). A cancelled subscription never comes back; a new one is
 *   a new checkout.
 *
 * **A read that says nothing decides nothing**: a pending or unknown status,
 * an unknown payment state while past due, or anything after CANCELED leaves
 * the subscription and its grant exactly as they are. Nothing here touches
 * training data; the most a lapse does is end the grant.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoredSubscription {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  pastDueSince: Date | null;
  cancelAtPeriodEnd: boolean;
}

export type GrantChange =
  /** Pro until this instant. */
  | { expiresAt: Date }
  /** Pro ends now: the grant is revoked, never deleted. */
  | 'REVOKE';

export type LifecycleDecision =
  | { kind: 'KEEP'; reason: string }
  | { kind: 'APPLY'; next: StoredSubscription; grant: GrantChange };

export type ProviderView = Pick<ProviderSubscription, 'status' | 'nextPaymentAt' | 'paymentState'>;

export function graceEnd(pastDueSince: Date): Date {
  return new Date(pastDueSince.getTime() + SUBSCRIPTION_GRACE_DAYS * DAY_MS);
}

/** Pro until `end`, or revoked when `end` has already passed. */
function grantUntil(end: Date | null, now: Date): GrantChange {
  return end && end.getTime() > now.getTime() ? { expiresAt: end } : 'REVOKE';
}

/**
 * What a subscription becomes after a read of the provider. `stored` is null
 * for one this server has not recorded yet -- the first confirmation of a
 * checkout -- and `trialEndsAt` is the trial that checkout opened, if any.
 */
export function nextSubscriptionState(
  stored: StoredSubscription | null,
  view: ProviderView,
  now: Date,
  trialEndsAt: Date | null = null,
): LifecycleDecision {
  if (stored?.status === 'CANCELED') {
    return { kind: 'KEEP', reason: 'CANCELED_IS_FINAL' };
  }
  const base: StoredSubscription = stored ?? {
    status: 'TRIALING',
    currentPeriodEnd: null,
    trialEndsAt,
    pastDueSince: null,
    cancelAtPeriodEnd: false,
  };

  switch (view.status) {
    case 'CANCELLED':
    case 'PAUSED': {
      if (!stored) return { kind: 'KEEP', reason: 'NEVER_AUTHORIZED' };
      // Past due, Pro ends with the grace period; in a trial nothing was
      // paid, so it ends with the trial whatever the provider says the first
      // charge would have been; otherwise with what was paid. The end is
      // stored as the period's, so every reader names the same day.
      const inTrial =
        base.status === 'TRIALING' && base.trialEndsAt !== null && now.getTime() < base.trialEndsAt.getTime();
      const end =
        base.status === 'PAST_DUE' && base.pastDueSince
          ? graceEnd(base.pastDueSince)
          : inTrial
            ? base.trialEndsAt
            : base.currentPeriodEnd;
      return {
        kind: 'APPLY',
        next: { ...base, status: 'CANCELED', cancelAtPeriodEnd: true, currentPeriodEnd: end },
        grant: grantUntil(end, now),
      };
    }
    case 'AUTHORIZED': {
      if (view.paymentState === 'FAILING') {
        const since = base.pastDueSince ?? now;
        return {
          kind: 'APPLY',
          next: { ...base, status: 'PAST_DUE', pastDueSince: since },
          grant: grantUntil(graceEnd(since), now),
        };
      }
      if (view.paymentState === 'UNKNOWN' && base.status === 'PAST_DUE') {
        return { kind: 'KEEP', reason: 'PAYMENT_STATE_UNKNOWN' };
      }
      const periodEnd = view.nextPaymentAt ?? base.currentPeriodEnd;
      const trialing = base.trialEndsAt !== null && now.getTime() < base.trialEndsAt.getTime();
      return {
        kind: 'APPLY',
        next: {
          ...base,
          status: trialing ? 'TRIALING' : 'ACTIVE',
          currentPeriodEnd: periodEnd,
          pastDueSince: null,
          cancelAtPeriodEnd: false,
        },
        grant: { expiresAt: subscriptionGrantExpiry(periodEnd, now) },
      };
    }
    default:
      return { kind: 'KEEP', reason: `PROVIDER_${view.status}` };
  }
}

/** Whether a decision moved the subscription into its grace period just now. */
export function enteredGracePeriod(
  stored: StoredSubscription | null,
  decision: LifecycleDecision,
): boolean {
  return decision.kind === 'APPLY' && decision.next.status === 'PAST_DUE' && stored?.status !== 'PAST_DUE';
}
