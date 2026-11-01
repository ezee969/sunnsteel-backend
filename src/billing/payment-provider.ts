/**
 * BILL-03: the payment provider behind checkout. Mercado Pago (preapproval
 * subscriptions) is the provider, because Stripe does not offer payment
 * accounts to individuals in Argentina; `FakePaymentProvider` drives the tests
 * and local development; the interface leaves room for another adapter.
 *
 * Only two operations exist, and neither decides access by itself: opening a
 * subscription checkout answers where to send the member, and reading a
 * subscription answers what the provider says now. `CheckoutService` grants
 * Pro only from that read.
 */

/** What the provider says about a subscription, in the provider's own terms. */
export type ProviderSubscriptionStatus =
  /** Opened, not yet authorized by the payer. */
  | 'PENDING'
  /** Authorized: the payer agreed and the provider will charge. */
  | 'AUTHORIZED'
  | 'PAUSED'
  | 'CANCELLED'
  /** Anything this adapter does not know; it neither grants nor revokes. */
  | 'UNKNOWN';

export interface ProviderSubscription {
  externalId: string;
  status: ProviderSubscriptionStatus;
  /** The reference this server gave when it opened it: the attempt's id. */
  externalReference: string | null;
  /** The next charge, when the provider reports one. */
  nextPaymentAt: Date | null;
}

export interface OpenCheckoutRequest {
  /** The attempt's id: the external reference and the idempotency key. */
  attemptId: string;
  payerEmail: string;
  /** What the payer sees on the provider's page. */
  reason: string;
  amount: number;
  currency: string;
  /** Where the provider sends the member back. */
  backUrl: string;
}

export interface OpenedCheckout {
  externalId: string;
  checkoutUrl: string;
}

export interface PaymentProvider {
  /** Stored on every attempt and subscription. */
  readonly id: string;
  /** True while payments run in the provider's sandbox. */
  readonly testMode: boolean;
  openSubscriptionCheckout(request: OpenCheckoutRequest): Promise<OpenedCheckout>;
  readSubscription(externalId: string): Promise<ProviderSubscription>;
}

/**
 * A provider call that failed. Nothing was charged when it is thrown, and the
 * member may try again; `code` is stored on a failed attempt.
 */
export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/** Nest's injection token for the configured provider, or null without one. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
