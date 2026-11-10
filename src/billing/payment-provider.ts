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
  /**
   * BILL-04: whether the latest charge went through. FAILING while the
   * provider is retrying a renewal; UNKNOWN when it does not say, which never
   * moves a subscription into or out of its grace period.
   */
  paymentState: ProviderPaymentState;
}

export type ProviderPaymentState = 'OK' | 'FAILING' | 'UNKNOWN';

/**
 * BILL-04: a notification the provider sent, once its signature checked out.
 * `resourceId` names what changed, in the provider's terms; the subscription
 * it belongs to is found with `subscriptionIdFor`.
 */
export interface ProviderNotificationEvent {
  externalEventId: string;
  topic: string;
  resourceId: string | null;
}

/** What arrived over HTTP, for the provider to authenticate. */
export interface IncomingNotification {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
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
  /** BILL-04: a free trial before the first charge, or null for none. */
  trialDays: number | null;
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
  /** BILL-04: stops every future charge. Cancelling one already cancelled succeeds. */
  cancelSubscription(externalId: string): Promise<void>;
  /**
   * BILL-04: the notification, when it is authentically the provider's;
   * null otherwise -- an unsigned or forged one is never stored.
   */
  parseNotification(incoming: IncomingNotification): ProviderNotificationEvent | null;
  /** BILL-04: the subscription a notification is about, or null for one that is about none. */
  subscriptionIdFor(event: ProviderNotificationEvent): Promise<string | null>;
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
