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
  type CheckoutAttemptSummary,
  type CheckoutOffer,
  type SubscriptionSummary,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import {
  attemptExpiry,
  checkoutBackUrl,
  confirmationOutcome,
  isReusable,
  payerEmail,
  subscriptionGrantExpiry,
} from './checkout-rules';
import { writeGrant, GRANT_CONFLICT_RETRIES } from './entitlement-grants';
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
  const pending = await db.checkoutAttempt.findFirst({ where: { userId, status: 'PENDING' } });
  return {
    available: provider !== null,
    testMode: provider?.testMode ?? true,
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
  ) {}

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
    const outcome = confirmationOutcome(attempt.id, read);
    if (outcome === 'WAIT') return toAttemptSummary(attempt);
    if (outcome === 'CANCEL') {
      await this.db.checkoutAttempt.updateMany({
        where: { id: attempt.id, status: { in: ['PENDING', 'EXPIRED'] } },
        data: { status: 'CANCELED', failureCode: `PROVIDER_${read.status}` },
      });
      return toAttemptSummary(await this.db.checkoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } }));
    }

    const externalId = attempt.externalId;
    for (let retry = 0; ; retry += 1) {
      try {
        const completed = await this.db.$transaction(async (tx) => {
          // The row lock makes two confirmations of one attempt take turns,
          // and the second finds it completed.
          const [locked] = await tx.$queryRaw<{ status: string }[]>`
            SELECT "status" FROM "CheckoutAttempt" WHERE "id" = ${attempt.id} FOR UPDATE`;
          if (locked?.status === 'COMPLETED') {
            return tx.checkoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
          }
          const subscription = await tx.subscription.upsert({
            where: { provider_externalId: { provider: attempt.provider, externalId } },
            create: {
              userId,
              planId: attempt.planId,
              status: 'ACTIVE',
              provider: attempt.provider,
              externalId,
              currentPeriodEnd: read.nextPaymentAt,
            },
            update: { status: 'ACTIVE', currentPeriodEnd: read.nextPaymentAt },
          });
          await writeGrant(
            tx,
            {
              userId,
              planId: PRO_PRICE.planId,
              source: 'SUBSCRIPTION',
              expiresAt: subscriptionGrantExpiry(read.nextPaymentAt, now),
              subscriptionId: subscription.id,
              note: provider.testMode ? 'Sandbox subscription' : null,
            },
            now,
          );
          return tx.checkoutAttempt.update({
            where: { id: attempt.id },
            data: { status: 'COMPLETED', completedAt: now, subscriptionId: subscription.id, failureCode: null },
          });
        });
        return toAttemptSummary(completed);
      } catch (error) {
        if (isUniqueViolation(error) && retry < GRANT_CONFLICT_RETRIES) continue;
        throw error;
      }
    }
  }
}
