import { CHECKOUT_ATTEMPT_TTL_MINUTES } from '@sunsteel/contracts';
import { FakePaymentProvider } from './fake-payment-provider';
import { MERCADO_PAGO_API, MercadoPagoAdapter } from './mercado-pago.adapter';
import type { PaymentProvider, ProviderSubscription } from './payment-provider';

/**
 * BILL-03: checkout's rules, pure so each is tested without a database or a
 * provider.
 */

type Env = Record<string, string | undefined>;

/** Whether this process runs as a deployment rather than on a developer's machine. */
export function isDeployed(env: Env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_NAME);
}

/**
 * The configured provider, or null when checkout is unavailable:
 *
 * - `BILLING_PROVIDER=mercadopago` needs `MERCADO_PAGO_ACCESS_TOKEN` **and**
 *   `MERCADO_PAGO_SANDBOX=true`. Charging real money waits on the owner's tax
 *   and provider situation, so a token without the sandbox flag opens nothing.
 * - `BILLING_PROVIDER=fake` is refused on any deployment, because it grants
 *   Pro without a payment.
 */
export function providerFromEnv(env: Env): PaymentProvider | null {
  switch (env.BILLING_PROVIDER?.trim().toLowerCase()) {
    case 'mercadopago': {
      const token = env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
      if (!token || env.MERCADO_PAGO_SANDBOX !== 'true') return null;
      // BILL-04: without the webhook secret no notification is accepted, and
      // the daily reconciliation still keeps every subscription current.
      const webhookSecret = env.MERCADO_PAGO_WEBHOOK_SECRET?.trim() || null;
      return new MercadoPagoAdapter(token, true, fetch, MERCADO_PAGO_API, webhookSecret);
    }
    case 'fake':
      return isDeployed(env) ? null : new FakePaymentProvider();
    default:
      return null;
  }
}

/** When a new attempt stops being offered again. */
export function attemptExpiry(now: Date): Date {
  return new Date(now.getTime() + CHECKOUT_ATTEMPT_TTL_MINUTES * 60 * 1000);
}

/** Whether a waiting attempt is still the one to send the member back to. */
export function isReusable(
  attempt: { status: string; expiresAt: Date; checkoutUrl: string | null },
  now: Date,
): boolean {
  return attempt.status === 'PENDING' && attempt.expiresAt.getTime() > now.getTime();
}

export type ConfirmationOutcome =
  /** The provider authorized it: Pro starts. */
  | 'GRANT'
  /** Not decided yet, or nothing this server can trust: read again later. */
  | 'WAIT'
  /** The provider reports it cancelled or paused: nothing is granted. */
  | 'CANCEL';

/**
 * What a confirmed read of the provider means for an attempt. **Returning
 * from checkout grants nothing**: only AUTHORIZED, on the subscription this
 * attempt opened (its external reference is the attempt's id), grants. An
 * unknown status or a reference that is not this attempt's neither grants nor
 * cancels.
 */
export function confirmationOutcome(
  attemptId: string,
  read: Pick<ProviderSubscription, 'status' | 'externalReference'>,
): ConfirmationOutcome {
  if (read.externalReference !== attemptId) return 'WAIT';
  switch (read.status) {
    case 'AUTHORIZED':
      return 'GRANT';
    case 'CANCELLED':
    case 'PAUSED':
      return 'CANCEL';
    default:
      return 'WAIT';
  }
}

/** Days past the provider's next charge that a subscription's grant lasts. */
export const SUBSCRIPTION_GRANT_SLACK_DAYS = 3;

/** A month, when the provider names no next charge. */
const DEFAULT_PERIOD_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Until when a subscription's grant runs: the provider's next charge plus a
 * few days' slack, so a renewal processed a little late never interrupts Pro.
 * It always ends -- `BILL-04` renews it from the provider's notifications --
 * so a subscription nothing reads again lapses rather than lasting forever.
 */
export function subscriptionGrantExpiry(nextPaymentAt: Date | null, now: Date): Date {
  const periodEnd =
    nextPaymentAt && nextPaymentAt.getTime() > now.getTime()
      ? nextPaymentAt
      : new Date(now.getTime() + DEFAULT_PERIOD_DAYS * DAY_MS);
  return new Date(periodEnd.getTime() + SUBSCRIPTION_GRANT_SLACK_DAYS * DAY_MS);
}

/**
 * Who Mercado Pago is told pays. In the sandbox the payer must be a test
 * buyer, whose email is never a member's, so `MERCADO_PAGO_TEST_PAYER_EMAIL`
 * stands in for it there.
 */
export function payerEmail(memberEmail: string, provider: PaymentProvider, env: Env): string {
  const testPayer = env.MERCADO_PAGO_TEST_PAYER_EMAIL?.trim();
  return provider.testMode && testPayer ? testPayer : memberEmail;
}

/** Where the provider sends the member back: the plans page, naming the attempt. */
export function checkoutBackUrl(frontendUrl: string | undefined, attemptId: string): string {
  const origin = (frontendUrl?.split(',')[0]?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  return `${origin}/plans?checkout=${encodeURIComponent(attemptId)}`;
}
