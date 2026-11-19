import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PaymentProviderError,
  type IncomingNotification,
  type ProviderCharge,
  type ProviderNotificationEvent,
  type ProviderPaymentState,
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

/** BILL-06: a page of the payments search, and the most pages read for one month. */
const CHARGES_PAGE_SIZE = 100;
const CHARGES_MAX_PAGES = 50;

/** A request that has not answered in this long is a provider error. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Anything shaped like an email address, taken out of a refusal before it is logged. */
const EMAIL_LIKE = /[^\s@"'<>,;:()]+@[^\s@"'<>,;:()]+/g;

/** The longest refusal reason kept. */
const REASON_MAX_LENGTH = 300;

/**
 * Mercado Pago's own words for a refusal -- its `error`, each `cause`'s code
 * and description, and its `message` -- with every email address replaced,
 * because a refusal can repeat the payer's. Without it a 400 says nothing
 * about why; the member is still told only that the provider refused.
 */
export function providerRefusalReason(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const { error, cause, message } = body as { error?: unknown; cause?: unknown; message?: unknown };
  const parts: string[] = [];
  if (typeof error === 'string') parts.push(error);
  for (const item of Array.isArray(cause) ? cause : []) {
    if (item === null || typeof item !== 'object') continue;
    const { code, description } = item as { code?: unknown; description?: unknown };
    const label = typeof code === 'string' || typeof code === 'number' ? `cause ${code}` : 'cause';
    parts.push(typeof description === 'string' && description ? `${label}: ${description}` : label);
  }
  if (typeof message === 'string') parts.push(message);
  const reason = parts
    .join('; ')
    .replace(EMAIL_LIKE, '<email>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, REASON_MAX_LENGTH);
  return reason || null;
}

type Fetch = typeof fetch;

const STATUSES: Record<string, ProviderSubscriptionStatus> = {
  pending: 'PENDING',
  authorized: 'AUTHORIZED',
  paused: 'PAUSED',
  cancelled: 'CANCELLED',
};

/**
 * BILL-04: whether the latest charge went through, from the preapproval's
 * `summarized.semaphore`: green is paid up, yellow and red are a renewal the
 * provider is retrying. Anything else says nothing.
 */
export function preapprovalPaymentState(summarized: unknown): ProviderPaymentState {
  const semaphore = (summarized as { semaphore?: unknown } | null)?.semaphore;
  if (semaphore === 'green') return 'OK';
  if (semaphore === 'yellow' || semaphore === 'red') return 'FAILING';
  return 'UNKNOWN';
}

function header(headers: IncomingNotification['headers'], name: string): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? null) : null;
}

/**
 * BILL-04: Mercado Pago signs a notification with `x-signature`
 * (`ts=<seconds>,v1=<hex>`): an HMAC-SHA256, under the application's webhook
 * secret, of `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, leaving out
 * any part it did not send; an alphanumeric `data.id` is lowercased.
 */
export function mercadoPagoSignatureValid(
  incoming: IncomingNotification,
  secret: string,
): boolean {
  const signature = header(incoming.headers, 'x-signature');
  if (!signature) return false;
  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const [key, ...rest] = part.split('=');
      return [key.trim(), rest.join('=').trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !/^[0-9a-f]+$/i.test(v1)) return false;
  const rawId = incoming.query['data.id'];
  const dataId = typeof rawId === 'string' ? (/^[a-z0-9]+$/i.test(rawId) ? rawId.toLowerCase() : rawId) : null;
  const requestId = header(incoming.headers, 'x-request-id');
  const manifest =
    (dataId ? `id:${dataId};` : '') + (requestId ? `request-id:${requestId};` : '') + `ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  const given = Buffer.from(v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A preapproval's status in Mercado Pago's words, read tolerantly. */
export function preapprovalStatus(value: unknown): ProviderSubscriptionStatus {
  return typeof value === 'string' ? (STATUSES[value] ?? 'UNKNOWN') : 'UNKNOWN';
}

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * BILL-06: one result of `/v1/payments/search` as a subscription charge, or
 * null. The search answers everything the account received -- a transfer, a
 * sale of something else, the $0 card validation that starts a trial -- and
 * only a subscription's charge is the owner's to invoice here, which Mercado
 * Pago marks with `point_of_interaction.type` `SUBSCRIPTIONS`.
 */
export function chargeFromPayment(payment: unknown): ProviderCharge | null {
  const p = (payment ?? {}) as Record<string, unknown>;
  const pointOfInteraction = p.point_of_interaction as { type?: unknown } | undefined;
  if (pointOfInteraction?.type !== 'SUBSCRIPTIONS') return null;
  const id = typeof p.id === 'number' || typeof p.id === 'string' ? String(p.id) : null;
  const createdAt = dateOrNull(p.date_created);
  const amount = typeof p.transaction_amount === 'number' ? p.transaction_amount : null;
  if (!id || !createdAt || amount === null) return null;
  const payer = (p.payer ?? {}) as { email?: unknown };
  return {
    id,
    createdAt,
    approvedAt: dateOrNull(p.date_approved),
    amount,
    currency: typeof p.currency_id === 'string' ? p.currency_id : '',
    status: typeof p.status === 'string' ? p.status : 'unknown',
    description: typeof p.description === 'string' ? p.description : null,
    payerEmail: typeof payer.email === 'string' && payer.email ? payer.email : null,
  };
}

export class MercadoPagoAdapter implements PaymentProvider {
  readonly id = 'MERCADO_PAGO';

  constructor(
    private readonly accessToken: string,
    /** Only sandbox credentials are accepted until real payments are decided. */
    readonly testMode: boolean,
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl: string = MERCADO_PAGO_API,
    /** BILL-04: without it no notification is ever accepted. */
    private readonly webhookSecret: string | null = null,
  ) {}

  private async request(
    path: string,
    init: { method: 'GET' | 'POST' | 'PUT'; body?: unknown; idempotencyKey?: string },
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
      // Never the response body as it came: it can echo the payer's email.
      throw new PaymentProviderError(
        `PROVIDER_HTTP_${response.status}`,
        `Mercado Pago answered ${response.status}`,
        providerRefusalReason(body),
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
          ...(request.trialDays
            ? { free_trial: { frequency: request.trialDays, frequency_type: 'days' } }
            : {}),
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
      paymentState: preapprovalPaymentState(body.summarized),
    };
  }

  async cancelSubscription(externalId: string): Promise<void> {
    await this.request(`/preapproval/${encodeURIComponent(externalId)}`, {
      method: 'PUT',
      body: { status: 'cancelled' },
    });
  }

  parseNotification(incoming: IncomingNotification): ProviderNotificationEvent | null {
    if (!this.webhookSecret || !mercadoPagoSignatureValid(incoming, this.webhookSecret)) return null;
    const body = (incoming.body ?? {}) as { id?: unknown; type?: unknown; data?: { id?: unknown } };
    const queryType = incoming.query.type;
    const topic = typeof body.type === 'string' ? body.type : typeof queryType === 'string' ? queryType : null;
    const eventId = typeof body.id === 'string' || typeof body.id === 'number' ? String(body.id) : null;
    const dataId = body.data?.id ?? incoming.query['data.id'];
    if (!topic || !eventId) return null;
    return {
      externalEventId: eventId.slice(0, 200),
      topic: topic.slice(0, 100),
      resourceId: typeof dataId === 'string' || typeof dataId === 'number' ? String(dataId).slice(0, 200) : null,
    };
  }

  /**
   * BILL-06: every payment created in `[from, to)` on this account, read page
   * by page from the payments search. A subscription's charges are payments
   * like any other, so this is what the owner invoices.
   */
  async listCharges(from: Date, to: Date): Promise<ProviderCharge[]> {
    const charges: ProviderCharge[] = [];
    // The search's end is inclusive; a millisecond before `to` keeps it half-open.
    const end = new Date(to.getTime() - 1).toISOString();
    for (let page = 0; page < CHARGES_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        sort: 'date_created',
        criteria: 'asc',
        range: 'date_created',
        begin_date: from.toISOString(),
        end_date: end,
        limit: String(CHARGES_PAGE_SIZE),
        offset: String(page * CHARGES_PAGE_SIZE),
      });
      const body = await this.request(`/v1/payments/search?${query.toString()}`, { method: 'GET' });
      const results: unknown[] = Array.isArray(body.results) ? body.results : [];
      for (const result of results) {
        const charge = chargeFromPayment(result);
        if (charge) charges.push(charge);
      }
      const paging = body.paging as { total?: unknown } | undefined;
      const total = typeof paging?.total === 'number' ? paging.total : 0;
      if (results.length < CHARGES_PAGE_SIZE || (page + 1) * CHARGES_PAGE_SIZE >= total) break;
    }
    return charges;
  }

  async subscriptionIdFor(event: ProviderNotificationEvent): Promise<string | null> {
    if (!event.resourceId) return null;
    if (event.topic === 'subscription_preapproval' || event.topic === 'preapproval') {
      return event.resourceId;
    }
    if (event.topic === 'subscription_authorized_payment') {
      const payment = await this.request(`/authorized_payments/${encodeURIComponent(event.resourceId)}`, {
        method: 'GET',
      });
      return typeof payment.preapproval_id === 'string' ? payment.preapproval_id : null;
    }
    return null;
  }
}
