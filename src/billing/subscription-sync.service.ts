import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { CheckoutAttempt, Prisma, Subscription } from '@prisma/client';
import { apiError, PRO_PRICE, SUBSCRIPTION_TRIAL_DAYS } from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { confirmationOutcome } from './checkout-rules';
import { writeGrant } from './entitlement-grants';
import {
  PAYMENT_PROVIDER,
  PaymentProviderError,
  type PaymentProvider,
  type ProviderSubscription,
} from './payment-provider';
import {
  enteredGracePeriod,
  graceEnd,
  nextSubscriptionState,
  type LifecycleDecision,
  type StoredSubscription,
} from './subscription-lifecycle';

type Tx = Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The subscriptions the daily reconciliation reads: every one that can still change. */
export const RECONCILED_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE'] as const;

function storedState(row: Subscription): StoredSubscription {
  return {
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    trialEndsAt: row.trialEndsAt,
    pastDueSince: row.pastDueSince,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

/**
 * BILL-04: applies the provider's word to a subscription. Every path that
 * learns something from the provider -- a checkout's confirmation (BILL-03),
 * a notification through the outbox, the daily reconciliation, a member
 * cancelling -- reads the provider first, outside any transaction, and then
 * calls one of these inside its own, so `nextSubscriptionState` is the only
 * rule and the subscription, its grant and the payment-failed notice always
 * commit together.
 */
@Injectable()
export class SubscriptionSyncService {
  private readonly logger = new Logger(SubscriptionSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null = null,
  ) {}

  /**
   * Writes a decision: the subscription row, its grant -- rewritten only when
   * the end changes, so a daily read writes nothing new -- and, on entering
   * the grace period, the in-app notice. A KEEP only records that it was read.
   */
  private async write(
    tx: Tx,
    target: { userId: string; provider: string; externalId: string; planId: string; existing: Subscription | null },
    decision: LifecycleDecision,
    now: Date,
  ): Promise<Subscription | null> {
    // Read before anything is written, so the comparison is with what was stored.
    const before = target.existing ? storedState(target.existing) : null;
    if (decision.kind === 'KEEP') {
      if (!target.existing) return null;
      return tx.subscription.update({ where: { id: target.existing.id }, data: { lastSyncedAt: now } });
    }
    const { next } = decision;
    const data = {
      status: next.status,
      currentPeriodEnd: next.currentPeriodEnd,
      trialEndsAt: next.trialEndsAt,
      pastDueSince: next.pastDueSince,
      cancelAtPeriodEnd: next.cancelAtPeriodEnd,
      lastSyncedAt: now,
    };
    const subscription = target.existing
      ? await tx.subscription.update({ where: { id: target.existing.id }, data })
      : await tx.subscription.upsert({
          where: { provider_externalId: { provider: target.provider, externalId: target.externalId } },
          create: {
            ...data,
            userId: target.userId,
            planId: target.planId,
            provider: target.provider,
            externalId: target.externalId,
          },
          update: data,
        });

    const open = await tx.entitlementGrant.findFirst({
      where: { userId: subscription.userId, source: 'SUBSCRIPTION', revokedAt: null },
    });
    if (decision.grant === 'REVOKE') {
      if (open?.subscriptionId === subscription.id) {
        await tx.entitlementGrant.update({ where: { id: open.id }, data: { revokedAt: now } });
      }
    } else if (
      !open ||
      open.subscriptionId !== subscription.id ||
      open.expiresAt?.getTime() !== decision.grant.expiresAt.getTime()
    ) {
      await writeGrant(
        tx,
        {
          userId: subscription.userId,
          planId: PRO_PRICE.planId,
          source: 'SUBSCRIPTION',
          expiresAt: decision.grant.expiresAt,
          subscriptionId: subscription.id,
          note: this.provider?.testMode === false ? null : 'Sandbox subscription',
        },
        now,
      );
    }

    if (enteredGracePeriod(before, decision) && next.pastDueSince) {
      await tx.notification.createMany({
        data: [
          {
            userId: subscription.userId,
            kind: 'SUBSCRIPTION_PAYMENT_FAILED',
            sourceKey: `subscription-past-due:${subscription.id}:${next.pastDueSince.toISOString()}`,
            payload: { graceEndsAt: graceEnd(next.pastDueSince).toISOString() },
            createdAt: now,
          },
        ],
        skipDuplicates: true,
      });
    }
    return subscription;
  }

  /**
   * BILL-03's confirmation, and a notification about a subscription this
   * server has only as an attempt: only an authorized subscription whose
   * external reference is this attempt creates the subscription and grants.
   */
  async applyToAttempt(tx: Tx, attemptId: string, read: ProviderSubscription, now: Date): Promise<CheckoutAttempt> {
    const [locked] = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status" FROM "CheckoutAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
    const attempt = await tx.checkoutAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (!locked || attempt.status === 'COMPLETED' || !attempt.externalId) return attempt;
    const outcome = confirmationOutcome(attempt.id, read);
    if (outcome === 'WAIT') return attempt;
    if (outcome === 'CANCEL') {
      return tx.checkoutAttempt.update({
        where: { id: attempt.id },
        data: { status: 'CANCELED', failureCode: `PROVIDER_${read.status}` },
      });
    }
    // The trial's length is ours (SUBSCRIPTION_TRIAL_DAYS, decided at claim),
    // so it is counted from the confirmation rather than read from the provider.
    const trialEndsAt = attempt.trialDays ? new Date(now.getTime() + attempt.trialDays * DAY_MS) : null;
    const existing = await tx.subscription.findUnique({
      where: { provider_externalId: { provider: attempt.provider, externalId: attempt.externalId } },
    });
    const decision = nextSubscriptionState(existing ? storedState(existing) : null, read, now, trialEndsAt);
    const subscription = await this.write(
      tx,
      { userId: attempt.userId, provider: attempt.provider, externalId: attempt.externalId, planId: attempt.planId, existing },
      decision,
      now,
    );
    if (!subscription) return attempt;
    return tx.checkoutAttempt.update({
      where: { id: attempt.id },
      data: { status: 'COMPLETED', completedAt: now, subscriptionId: subscription.id, failureCode: null },
    });
  }

  /**
   * Applies a read of one provider subscription to whatever this server holds
   * for it: the subscription, else a waiting attempt that opened it. Answers
   * what happened, for the notification's record.
   */
  async applyExternal(tx: Tx, providerId: string, externalId: string, read: ProviderSubscription, now: Date): Promise<string> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Subscription" WHERE "provider" = ${providerId} AND "externalId" = ${externalId} FOR UPDATE`;
    if (row) {
      const existing = await tx.subscription.findUniqueOrThrow({ where: { id: row.id } });
      const decision = nextSubscriptionState(storedState(existing), read, now);
      await this.write(
        tx,
        { userId: existing.userId, provider: providerId, externalId, planId: existing.planId, existing },
        decision,
        now,
      );
      return decision.kind === 'KEEP' ? `KEPT_${decision.reason}` : `APPLIED_${decision.next.status}`;
    }
    const attempt = await tx.checkoutAttempt.findFirst({
      where: { provider: providerId, externalId, status: { in: ['PENDING', 'EXPIRED'] } },
    });
    if (!attempt) return 'UNKNOWN_SUBSCRIPTION';
    const after = await this.applyToAttempt(tx, attempt.id, read, now);
    return `ATTEMPT_${after.status}`;
  }

  /** One subscription read and applied in its own transaction. */
  async sync(subscription: Pick<Subscription, 'provider' | 'externalId'>, now: Date = new Date()): Promise<string> {
    const provider = this.provider;
    if (!provider || provider.id !== subscription.provider || !subscription.externalId) {
      return 'PROVIDER_NOT_CONFIGURED';
    }
    const externalId = subscription.externalId;
    const read = await provider.readSubscription(externalId);
    return this.db.$transaction((tx) => this.applyExternal(tx, provider.id, externalId, read, now), {
      timeout: 30_000,
    });
  }

  /**
   * BILL-04's daily reconciliation: every subscription that can still change
   * is read from the provider, so a notification that never arrived costs a
   * day at most. One failure is logged and the rest continue.
   */
  @Cron('15 4 * * *')
  async reconcileAll(now: Date = new Date()): Promise<{ read: number; failed: number }> {
    if (!this.provider) return { read: 0, failed: 0 };
    const rows = await this.db.subscription.findMany({
      where: { provider: this.provider.id, status: { in: [...RECONCILED_STATUSES] }, externalId: { not: null } },
      select: { id: true, provider: true, externalId: true },
      orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    });
    let failed = 0;
    for (const row of rows) {
      try {
        await this.sync(row, now);
      } catch (error) {
        failed += 1;
        const code = error instanceof PaymentProviderError ? error.code : 'ERROR';
        this.logger.warn(`Reconciling subscription ${row.id} failed: ${code}`);
      }
    }
    return { read: rows.length, failed };
  }

  /**
   * `POST /billing/subscription/cancel`: stops every future charge at the
   * provider, then records it through the same rule, so Pro lasts to the end
   * of what was paid -- or of the grace period when a renewal was failing.
   */
  async cancel(userId: string, now: Date = new Date()): Promise<void> {
    const subscription = await this.db.subscription.findFirst({
      where: { userId, status: { in: [...RECONCILED_STATUSES] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!subscription || !subscription.externalId) {
      throw new ConflictException(apiError('SUBSCRIPTION_NOT_ACTIVE'));
    }
    const provider = this.provider;
    if (!provider || provider.id !== subscription.provider) {
      throw new ConflictException(apiError('SUBSCRIPTION_NOT_ACTIVE'));
    }
    try {
      await provider.cancelSubscription(subscription.externalId);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        this.logger.warn(`Cancelling at the provider failed: ${error.code}`);
        throw new BadGatewayException(apiError('CHECKOUT_PROVIDER_ERROR'));
      }
      throw error;
    }
    const externalId = subscription.externalId;
    await this.db.$transaction(
      (tx) =>
        this.applyExternal(
          tx,
          provider.id,
          externalId,
          { externalId, status: 'CANCELLED', externalReference: null, nextPaymentAt: null, paymentState: 'UNKNOWN' },
          now,
        ),
      { timeout: 30_000 },
    );
  }

  /**
   * Account deletion (TRUST-01): stops the provider charging an account that
   * no longer exists. Best effort -- a provider that cannot be reached never
   * keeps a member from deleting their account -- and logged when it fails.
   */
  async cancelForDeletion(userId: string): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    const rows = await this.db.subscription.findMany({
      where: { userId, provider: provider.id, status: { in: [...RECONCILED_STATUSES] }, externalId: { not: null } },
      select: { id: true, externalId: true },
    });
    for (const row of rows) {
      try {
        await provider.cancelSubscription(row.externalId!);
      } catch (error) {
        const code = error instanceof PaymentProviderError ? error.code : 'ERROR';
        this.logger.error(`Cancelling subscription ${row.id} before deleting its account failed: ${code}`);
      }
    }
  }

  /** Whether an account may start a free trial: one per account, ever. */
  async trialDaysFor(db: Pick<Tx, 'subscription'>, userId: string): Promise<number | null> {
    const had = await db.subscription.count({ where: { userId } });
    return had === 0 ? SUBSCRIPTION_TRIAL_DAYS : null;
  }
}
