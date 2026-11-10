import { randomUUID } from 'node:crypto';
import {
  PaymentProviderError,
  type IncomingNotification,
  type OpenCheckoutRequest,
  type OpenedCheckout,
  type PaymentProvider,
  type ProviderNotificationEvent,
  type ProviderPaymentState,
  type ProviderSubscription,
  type ProviderSubscriptionStatus,
} from './payment-provider';

/**
 * BILL-03: a provider that charges nothing and lives in memory, for the
 * tests and local development. Its checkout page is the back URL itself, so
 * returning from it is immediate, and a subscription it opened reads as
 * `outcome` -- AUTHORIZED unless a test says otherwise. It is never offered in
 * production (`providerFromEnv`).
 *
 * BILL-04: `paymentState` stands for a renewal that succeeded or is being
 * retried, a cancelled subscription reads CANCELLED, and a notification is
 * accepted when it carries `x-fake-signature: fake` -- a value no deployment
 * can reach, because the fake never runs on one.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly id = 'FAKE';
  readonly testMode = true;
  readonly opened: OpenCheckoutRequest[] = [];
  readonly cancelled = new Set<string>();
  private readonly subscriptions = new Map<string, ProviderSubscription>();

  constructor(
    public outcome: ProviderSubscriptionStatus = 'AUTHORIZED',
    /** A month ahead unless a test pins it. */
    public nextPaymentAt: () => Date = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    /** When set, the next call fails with it. */
    public failNext: string | null = null,
    public paymentState: ProviderPaymentState = 'OK',
  ) {}

  private maybeFail(): void {
    if (this.failNext === null) return;
    const code = this.failNext;
    this.failNext = null;
    throw new PaymentProviderError(code, 'The fake provider failed on purpose');
  }

  async openSubscriptionCheckout(request: OpenCheckoutRequest): Promise<OpenedCheckout> {
    this.maybeFail();
    this.opened.push(request);
    const existing = [...this.subscriptions.values()].find(
      (subscription) => subscription.externalReference === request.attemptId,
    );
    const externalId = existing?.externalId ?? `fake-${randomUUID()}`;
    if (!existing) {
      this.subscriptions.set(externalId, {
        externalId,
        status: 'PENDING',
        externalReference: request.attemptId,
        nextPaymentAt: null,
        paymentState: 'UNKNOWN',
      });
    }
    return { externalId, checkoutUrl: request.backUrl };
  }

  async readSubscription(externalId: string): Promise<ProviderSubscription> {
    this.maybeFail();
    const subscription = this.subscriptions.get(externalId);
    if (!subscription) throw new PaymentProviderError('PROVIDER_HTTP_404', 'No such fake subscription');
    const status = this.cancelled.has(externalId) ? 'CANCELLED' : this.outcome;
    return {
      ...subscription,
      status,
      nextPaymentAt: status === 'AUTHORIZED' ? this.nextPaymentAt() : null,
      paymentState: status === 'AUTHORIZED' ? this.paymentState : 'UNKNOWN',
    };
  }

  async cancelSubscription(externalId: string): Promise<void> {
    this.maybeFail();
    if (!this.subscriptions.has(externalId)) {
      throw new PaymentProviderError('PROVIDER_HTTP_404', 'No such fake subscription');
    }
    this.cancelled.add(externalId);
  }

  parseNotification(incoming: IncomingNotification): ProviderNotificationEvent | null {
    if (incoming.headers['x-fake-signature'] !== 'fake') return null;
    const body = (incoming.body ?? {}) as { id?: unknown; type?: unknown; data?: { id?: unknown } };
    if (typeof body.id !== 'string' || typeof body.type !== 'string') return null;
    return {
      externalEventId: body.id,
      topic: body.type,
      resourceId: typeof body.data?.id === 'string' ? body.data.id : null,
    };
  }

  async subscriptionIdFor(event: ProviderNotificationEvent): Promise<string | null> {
    return event.topic === 'subscription_preapproval' ? event.resourceId : null;
  }

  /** Tests: a subscription that exists only at the provider. */
  seed(subscription: ProviderSubscription): void {
    this.subscriptions.set(subscription.externalId, subscription);
  }
}
