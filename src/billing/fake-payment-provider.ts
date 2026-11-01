import { randomUUID } from 'node:crypto';
import {
  PaymentProviderError,
  type OpenCheckoutRequest,
  type OpenedCheckout,
  type PaymentProvider,
  type ProviderSubscription,
  type ProviderSubscriptionStatus,
} from './payment-provider';

/**
 * BILL-03: a provider that charges nothing and lives in memory, for the
 * tests and local development. Its checkout page is the back URL itself, so
 * returning from it is immediate, and a subscription it opened reads as
 * `outcome` -- AUTHORIZED unless a test says otherwise. It is never offered in
 * production (`providerFromEnv`).
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly id = 'FAKE';
  readonly testMode = true;
  readonly opened: OpenCheckoutRequest[] = [];
  private readonly subscriptions = new Map<string, ProviderSubscription>();

  constructor(
    public outcome: ProviderSubscriptionStatus = 'AUTHORIZED',
    /** A month ahead unless a test pins it. */
    public nextPaymentAt: () => Date = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    /** When set, the next call fails with it. */
    public failNext: string | null = null,
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
      });
    }
    return { externalId, checkoutUrl: request.backUrl };
  }

  async readSubscription(externalId: string): Promise<ProviderSubscription> {
    this.maybeFail();
    const subscription = this.subscriptions.get(externalId);
    if (!subscription) throw new PaymentProviderError('PROVIDER_HTTP_404', 'No such fake subscription');
    return {
      ...subscription,
      status: this.outcome,
      nextPaymentAt: this.outcome === 'AUTHORIZED' ? this.nextPaymentAt() : null,
    };
  }
}
