import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type CheckoutAttempt, type PrismaClient } from '@prisma/client';
import {
  apiError,
  isPlanId,
  PRO_PRICE,
  SUBSCRIPTION_TRIAL_DAYS,
  type CheckoutAttemptSummary,
  type CheckoutOffer,
  type SubscriptionSummary,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { attemptExpiry, checkoutBackUrl, isReusable, payerEmail } from './checkout-rules';
import { GRANT_CONFLICT_RETRIES } from './entitlement-grants';
import { graceEnd } from './subscription-lifecycle';
import { SubscriptionSyncService } from './subscription-sync.service';
import { PAYMENT_PROVIDER, PaymentProviderError, type PaymentProvider } from './payment-provider';
import { planOf } from './plan-of';

type CheckoutDb = Pick<PrismaClient, 'checkoutAttempt' | 'subscription'>;

/** The environment checkout reads (`FRONTEND_URL`, the sandbox payer); tests pass their own. */
export const CHECKOUT_ENV = Symbol('CHECKOUT_ENV');

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function toAttemptSummary(attempt: CheckoutAttempt): CheckoutAttemptSummary {
  return {
    id: attempt.id,
    planId: isPlanId(attempt.planId) ? attempt.planId : 'PRO',
    status: attempt.status,
    checkoutUrl: attempt.status === 'PENDING' ? attempt.checkoutUrl : null,
    createdAt: attempt.createdAt.toISOString(),
    expiresAt: attempt.expiresAt.toISOString(),
  };
}

/**
 * What `GET /billing/me` says about buying Pro: whether a provider is
 * configured, whether it is the sandbox, the price, and an attempt still
 * waiting -- so the page sends the member back to it rather than opening
 * another.
 */
export async function checkoutOffer(
  db: CheckoutDb,
  provider: PaymentProvider | null,
  userId: string,
  now: Date,
): Promise<CheckoutOffer> {
  const [pending, subscriptions] = await Promise.all([
    db.checkoutAttempt.findFirst({ where: { userId, status: 'PENDING' } }),
    db.subscription.count({ where: { userId } }),
  ]);
  return {
    available: provider !== null,
    testMode: provider?.testMode ?? true,
    // BILL-04: one free trial per account, ever.
    trialDays: subscriptions === 0 ? SUBSCRIPTION_TRIAL_DAYS : null,
    price: PRO_PRICE,
    pending: pending && isReusable(pending, now) && pending.checkoutUrl ? toAttemptSummary(pending) : null,
  };
}

/** The member's latest subscription, as `GET /billing/me` states it. */
export async function latestSubscription(
  db: CheckoutDb,
  userId: string,
): Promise<SubscriptionSummary | null> {
  const subscription = await db.subscription.findFirst({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (!subscription || !isPlanId(subscription.planId)) return null;
  return {
    planId: subscription.planId,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    createdAt: subscription.createdAt.toISOString(),
    trialEndsAt:
      subscription.status === 'TRIALING' ? (subscription.trialEndsAt?.toISOString() ?? null) : null,
    graceEndsAt:
      subscription.status === 'PAST_DUE' && subscription.pastDueSince
        ? graceEnd(subscription.pastDueSince).toISOString()
        : null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}

/**
 * BILL-03: buying Pro through the payment provider's own page. Two calls,
 * and neither trusts the browser:
 *
 * - `start` opens (or returns) the member's one waiting attempt. The attempt
 *   row is written first, so the partial unique index
 *   `CheckoutAttempt_one_pending_per_user` lets only one exist however many
 *   tabs press at once; the provider is then asked with the attempt's id as
 *   the idempotency key, so a retry after a crash opens nothing new.
 * - `confirm` reads the provider. **Returning from checkout grants nothing**:
 *   only a subscription the provider reports authorized, whose external
 *   reference is this attempt, writes the `Subscription`, the `SUBSCRIPTION`
 *   grant and the completed attempt in one transaction.
 *
 * A provider error never charges and never changes an attempt the member can
 * retry; it is answered as 502 `CHECKOUT_PROVIDER_ERROR`.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null = null,
    @Optional() @Inject(CHECKOUT_ENV) private readonly env: Record<string, string | undefined> = process.env,
    @Optional() sync?: SubscriptionSyncService,
  ) {
    this.sync = sync ?? new SubscriptionSyncService(db, provider);
  }

  private readonly sync: SubscriptionSyncService;

  private requireProvider(): PaymentProvider {
    if (!this.provider) throw new ServiceUnavailableException(apiError('CHECKOUT_UNAVAILABLE'));
    return this.provider;
  }

  private providerError(error: unknown): never {
    if (error instanceof PaymentProviderError) {
      this.logger.warn(`Payment provider: ${error.code}`);
      throw new BadGatewayException(apiError('CHECKOUT_PROVIDER_ERROR'));
    }
    throw error;
  }

  /** `POST /billing/checkout`. */
  async start(user: { id: string; email: string }, now: Date = new Date()): Promise<CheckoutAttemptSummary> {
    const provider = this.requireProvider();
    if ((await planOf(this.db, user.id, now)) === 'PRO') {
      throw new ConflictException(apiError('PLAN_ALREADY_PRO'));
    }
    const attempt = await this.waitingAttempt(user.id, provider, now);
    if (attempt.checkoutUrl) return toAttemptSummary(attempt);

    try {
      const opened = await provider.openSubscriptionCheckout({
        attemptId: attempt.id,
        payerEmail: payerEmail(user.email, provider, this.env),
        reason: 'Sunnsteel Pro',
        amount: PRO_PRICE.amount,
        currency: PRO_PRICE.currency,
        backUrl: checkoutBackUrl(this.env.FRONTEND_URL, attempt.id),
        trialDays: attempt.trialDays,
      });
      const updated = await this.db.checkoutAttempt.update({
        where: { id: attempt.id },
        data: { externalId: opened.externalId, checkoutUrl: opened.checkoutUrl },
      });
      return toAttemptSummary(updated);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        // Closed, so the next press opens a new attempt.
        await this.db.checkoutAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', failureCode: error.code.slice(0, 100) },
        });
      }
      return this.providerError(error);
    }
  }

  /**
   * The member's one waiting attempt: the reusable one, or a new one after
   * expiring a stale one. Two presses racing meet the partial unique index,
   * and the loser reads the winner's.
   */
  private async waitingAttempt(
    userId: string,
    provider: PaymentProvider,
    now: Date,
  ): Promise<CheckoutAttempt> {
    for (let attempt = 0; ; attempt += 1) {
      const pending = await this.db.checkoutAttempt.findFirst({ where: { userId, status: 'PENDING' } });
      if (pending && isReusable(pending, now)) return pending;
      try {
        return await this.db.$transaction(async (tx) => {
          if (pending) {
            await tx.checkoutAttempt.updateMany({
              where: { id: pending.id, status: 'PENDING' },
              data: { status: 'EXPIRED' },
            });
          }
          return tx.checkoutAttempt.create({
            data: {
              userId,
              planId: PRO_PRICE.planId,
              provider: provider.id,
              expiresAt: attemptExpiry(now),
              trialDays: await this.sync.trialDaysFor(tx, userId),
            },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error) && attempt < GRANT_CONFLICT_RETRIES) continue;
        throw error;
      }
    }
  }

  /** `POST /billing/checkout/:id/confirm`. */
  async confirm(userId: string, attemptId: string, now: Date = new Date()): Promise<CheckoutAttemptSummary> {
    const attempt = await this.db.checkoutAttempt.findFirst({ where: { id: attemptId, userId } });
    if (!attempt) throw new NotFoundException('Checkout not found');
    // Only a waiting attempt -- or one that expired while the member was on
    // the provider's page -- is read again; a decided one is answered as is.
    if (!['PENDING', 'EXPIRED'].includes(attempt.status) || !attempt.externalId) {
      return toAttemptSummary(attempt);
    }
    const provider = this.requireProvider();
    if (provider.id !== attempt.provider) return toAttemptSummary(attempt);

    let read;
    try {
      read = await provider.readSubscription(attempt.externalId);
    } catch (error) {
      return this.providerError(error);
    }
    for (let retry = 0; ; retry += 1) {
      try {
        const after = await this.db.$transaction(
          (tx) => this.sync.applyToAttempt(tx, attempt.id, read, now),
          { timeout: 30_000 },
        );
        return toAttemptSummary(after);
      } catch (error) {
        if (isUniqueViolation(error) && retry < GRANT_CONFLICT_RETRIES) continue;
        throw error;
      }
    }
  }
}
