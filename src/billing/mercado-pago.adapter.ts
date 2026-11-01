import {
  PaymentProviderError,
  type OpenCheckoutRequest,
  type OpenedCheckout,
  type PaymentProvider,
  type ProviderSubscription,
  type ProviderSubscriptionStatus,
} from './payment-provider';

/**
 * BILL-03: Mercado Pago preapproval subscriptions over its REST API. Opening
 * a checkout creates a `pending` preapproval without a card -- the payer
 * authorizes it on Mercado Pago's own page (`init_point`), so card data never
 * reaches Sunnsteel -- and reading one asks for its current status.
 *
 * Every request carries the access token in a header and nothing else of the
 * server's; creating one carries the attempt's id as `X-Idempotency-Key`, so a
 * retried open never makes a second preapproval.
 */
export const MERCADO_PAGO_API = 'https://api.mercadopago.com';

/** A request that has not answered in this long is a provider error. */
const REQUEST_TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

const STATUSES: Record<string, ProviderSubscriptionStatus> = {
  pending: 'PENDING',
  authorized: 'AUTHORIZED',
  paused: 'PAUSED',
  cancelled: 'CANCELLED',
};

/** A preapproval's status in Mercado Pago's words, read tolerantly. */
export function preapprovalStatus(value: unknown): ProviderSubscriptionStatus {
  return typeof value === 'string' ? (STATUSES[value] ?? 'UNKNOWN') : 'UNKNOWN';
}

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class MercadoPagoAdapter implements PaymentProvider {
  readonly id = 'MERCADO_PAGO';

  constructor(
    private readonly accessToken: string,
    /** Only sandbox credentials are accepted until real payments are decided. */
    readonly testMode: boolean,
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl: string = MERCADO_PAGO_API,
  ) {}

  private async request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...(init.idempotencyKey ? { 'X-Idempotency-Key': init.idempotencyKey } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new PaymentProviderError('PROVIDER_UNREACHABLE', 'Mercado Pago did not answer');
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      // Never the response body: it can echo the payer's email.
      throw new PaymentProviderError(
        `PROVIDER_HTTP_${response.status}`,
        `Mercado Pago answered ${response.status}`,
      );
    }
    if (body === null || typeof body !== 'object') {
      throw new PaymentProviderError('PROVIDER_BAD_RESPONSE', 'Mercado Pago answered without a body');
    }
    return body as Record<string, unknown>;
  }

  async openSubscriptionCheckout(request: OpenCheckoutRequest): Promise<OpenedCheckout> {
    const body = await this.request('/preapproval', {
      method: 'POST',
      idempotencyKey: request.attemptId,
      body: {
        reason: request.reason,
        external_reference: request.attemptId,
        payer_email: request.payerEmail,
        back_url: request.backUrl,
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: request.amount,
          currency_id: request.currency,
        },
      },
    });
    const externalId = body.id;
    const checkoutUrl = this.testMode
      ? (body.sandbox_init_point ?? body.init_point)
      : body.init_point;
    if (typeof externalId !== 'string' || typeof checkoutUrl !== 'string') {
      throw new PaymentProviderError('PROVIDER_BAD_RESPONSE', 'Mercado Pago opened no checkout page');
    }
    return { externalId, checkoutUrl };
  }

  async readSubscription(externalId: string): Promise<ProviderSubscription> {
    const body = await this.request(`/preapproval/${encodeURIComponent(externalId)}`, {
      method: 'GET',
    });
    return {
      externalId,
      status: preapprovalStatus(body.status),
      externalReference: typeof body.external_reference === 'string' ? body.external_reference : null,
      nextPaymentAt: dateOrNull(body.next_payment_date),
    };
  }
}
