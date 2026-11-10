import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpException } from '@nestjs/common';
import { PRO_PRICE } from '@sunsteel/contracts';
import {
  checkoutBackUrl,
  confirmationOutcome,
  isReusable,
  payerEmail,
  providerFromEnv,
  subscriptionGrantExpiry,
} from '../src/billing/checkout-rules';
import { checkoutOffer, CheckoutService } from '../src/billing/checkout.service';
import { FakePaymentProvider } from '../src/billing/fake-payment-provider';
import { MercadoPagoAdapter, preapprovalStatus } from '../src/billing/mercado-pago.adapter';
import { PaymentProviderError } from '../src/billing/payment-provider';
import type { DatabaseService } from '../src/database/database.service';
import { memoryDb, NOW, type Row } from './billing-memory-db';

const DAY = 24 * 60 * 60 * 1000;
const USER = { id: 'member-1', email: 'member@example.com' };

function codeOf(error: unknown): string | undefined {
  return ((error as HttpException).getResponse() as { code?: string }).code;
}

function statusOf(error: unknown): number {
  return (error as HttpException).getStatus();
}

const ENV = { FRONTEND_URL: 'https://app.example.com' };

function setup(provider: FakePaymentProvider | null = new FakePaymentProvider(), grants: Row[] = []) {
  const db = memoryDb(grants);
  return {
    db,
    provider,
    checkout: new CheckoutService(db as unknown as DatabaseService, provider, ENV),
  };
}

const heldPro = (): Row => ({
  id: 'grant',
  userId: USER.id,
  planId: 'PRO',
  source: 'PROMO',
  startsAt: new Date(NOW.getTime() - DAY),
  expiresAt: null,
  revokedAt: null,
});

describe('which provider runs (BILL-03)', () => {
  it('offers no checkout without a provider, and never real money', () => {
    assert.equal(providerFromEnv({}), null);
    assert.equal(providerFromEnv({ BILLING_PROVIDER: 'mercadopago' }), null);
    assert.equal(
      providerFromEnv({ BILLING_PROVIDER: 'mercadopago', MERCADO_PAGO_ACCESS_TOKEN: 'token' }),
      null,
      'a token without the sandbox flag opens nothing',
    );
    const sandbox = providerFromEnv({
      BILLING_PROVIDER: 'mercadopago',
      MERCADO_PAGO_ACCESS_TOKEN: 'token',
      MERCADO_PAGO_SANDBOX: 'true',
    });
    assert.ok(sandbox instanceof MercadoPagoAdapter);
    assert.equal(sandbox.testMode, true);
  });

  it('refuses the fake provider on any deployment, because it grants Pro for nothing', () => {
    assert.ok(providerFromEnv({ BILLING_PROVIDER: 'fake' }) instanceof FakePaymentProvider);
    for (const deployed of [{ NODE_ENV: 'production' }, { RAILWAY_PROJECT_ID: 'x' }, { RAILWAY_ENVIRONMENT_NAME: 'y' }]) {
      assert.equal(providerFromEnv({ BILLING_PROVIDER: 'fake', ...deployed }), null);
    }
  });
});

describe('checkout rules (BILL-03)', () => {
  const read = (status: 'AUTHORIZED' | 'PENDING' | 'PAUSED' | 'CANCELLED' | 'UNKNOWN', reference = 'a') => ({
    status,
    externalReference: reference,
  });

  it('grants only for an authorized subscription this attempt opened', () => {
    assert.equal(confirmationOutcome('a', read('AUTHORIZED')), 'GRANT');
    assert.equal(confirmationOutcome('a', read('AUTHORIZED', 'another')), 'WAIT');
    assert.equal(confirmationOutcome('a', { status: 'AUTHORIZED', externalReference: null }), 'WAIT');
    assert.equal(confirmationOutcome('a', read('PENDING')), 'WAIT');
    assert.equal(confirmationOutcome('a', read('UNKNOWN')), 'WAIT');
    assert.equal(confirmationOutcome('a', read('CANCELLED')), 'CANCEL');
    assert.equal(confirmationOutcome('a', read('PAUSED')), 'CANCEL');
  });

  it('ends a grant three days past the next charge, and always ends it', () => {
    const next = new Date(NOW.getTime() + 30 * DAY);
    assert.equal(subscriptionGrantExpiry(next, NOW).getTime(), NOW.getTime() + 33 * DAY);
    assert.equal(subscriptionGrantExpiry(null, NOW).getTime(), NOW.getTime() + 34 * DAY);
    const past = new Date(NOW.getTime() - DAY);
    assert.equal(subscriptionGrantExpiry(past, NOW).getTime(), NOW.getTime() + 34 * DAY);
  });

  it('offers an attempt again only while it waits and has not expired', () => {
    const later = new Date(NOW.getTime() + 1000);
    assert.equal(isReusable({ status: 'PENDING', expiresAt: later, checkoutUrl: 'u' }, NOW), true);
    assert.equal(isReusable({ status: 'PENDING', expiresAt: NOW, checkoutUrl: 'u' }, NOW), false);
    assert.equal(isReusable({ status: 'FAILED', expiresAt: later, checkoutUrl: 'u' }, NOW), false);
  });

  it('uses the test buyer only in the sandbox', () => {
    const env = { MERCADO_PAGO_TEST_PAYER_EMAIL: ' buyer@testuser.com ' };
    assert.equal(payerEmail('m@x.com', new FakePaymentProvider(), env), 'buyer@testuser.com');
    assert.equal(payerEmail('m@x.com', new FakePaymentProvider(), {}), 'm@x.com');
    assert.equal(payerEmail('m@x.com', new MercadoPagoAdapter('t', false), env), 'm@x.com');
  });

  it('sends the member back to the plans page naming the attempt', () => {
    assert.equal(checkoutBackUrl('https://app.example.com/', 'a b'), 'https://app.example.com/plans?checkout=a%20b');
    assert.equal(checkoutBackUrl('https://a.com, https://b.com', 'x'), 'https://a.com/plans?checkout=x');
    assert.equal(checkoutBackUrl(undefined, 'x'), 'http://localhost:3000/plans?checkout=x');
  });
});

describe('the Mercado Pago adapter (BILL-03)', () => {
  function respond(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { calls, adapter: new MercadoPagoAdapter('secret-token', true, fetchImpl, 'https://mp.test') };
  }
  const request = {
    attemptId: 'attempt-1',
    payerEmail: 'buyer@testuser.com',
    reason: 'Sunnsteel Pro',
    amount: 4999,
    currency: 'ARS',
    backUrl: 'https://app.example.com/plans?checkout=attempt-1',
    trialDays: null,
  };

  it('opens a pending monthly preapproval, idempotent on the attempt', async () => {
    const { calls, adapter } = respond(201, { id: 'pre-1', init_point: 'https://mp.test/pay' });
    assert.deepEqual(await adapter.openSubscriptionCheckout(request), {
      externalId: 'pre-1',
      checkoutUrl: 'https://mp.test/pay',
    });
    assert.equal(calls[0].url, 'https://mp.test/preapproval');
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer secret-token');
    assert.equal(headers['X-Idempotency-Key'], 'attempt-1');
    assert.deepEqual(JSON.parse(calls[0].init.body as string), {
      reason: 'Sunnsteel Pro',
      external_reference: 'attempt-1',
      payer_email: 'buyer@testuser.com',
      back_url: request.backUrl,
      status: 'pending',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 4999,
        currency_id: 'ARS',
      },
    });
  });

  it('never carries a card or a card token', async () => {
    const { calls, adapter } = respond(201, { id: 'pre-1', init_point: 'https://mp.test/pay' });
    await adapter.openSubscriptionCheckout(request);
    assert.doesNotMatch(calls[0].init.body as string, /card/i);
  });

  it('reads a preapproval, tolerating what it does not know', async () => {
    const { calls, adapter } = respond(200, {
      status: 'authorized',
      external_reference: 'attempt-1',
      next_payment_date: '2026-12-01T12:00:00.000-03:00',
    });
    assert.deepEqual(await adapter.readSubscription('pre/1'), {
      externalId: 'pre/1',
      status: 'AUTHORIZED',
      externalReference: 'attempt-1',
      nextPaymentAt: new Date('2026-12-01T15:00:00.000Z'),
      paymentState: 'UNKNOWN',
    });
    assert.equal(calls[0].url, 'https://mp.test/preapproval/pre%2F1');
    assert.equal(preapprovalStatus('something_new'), 'UNKNOWN');
    assert.equal(preapprovalStatus(undefined), 'UNKNOWN');
    const blank = respond(200, { status: 'paused', next_payment_date: 'soon' });
    assert.deepEqual(await blank.adapter.readSubscription('p'), {
      externalId: 'p',
      status: 'PAUSED',
      externalReference: null,
      nextPaymentAt: null,
      paymentState: 'UNKNOWN',
    });
  });

  it('turns a refusal into a provider error that repeats nothing it answered', async () => {
    const { adapter } = respond(400, { message: 'payer_email buyer@testuser.com is invalid' });
    await assert.rejects(adapter.openSubscriptionCheckout(request), (error: PaymentProviderError) => {
      assert.equal(error.code, 'PROVIDER_HTTP_400');
      assert.doesNotMatch(error.message, /buyer/);
      return true;
    });
  });

  it('reports an unreachable provider and a page it did not get', async () => {
    const down = new MercadoPagoAdapter('t', true, (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch);
    await assert.rejects(down.readSubscription('p'), { code: 'PROVIDER_UNREACHABLE' });
    const { adapter } = respond(201, { id: 'pre-1' });
    await assert.rejects(adapter.openSubscriptionCheckout(request), { code: 'PROVIDER_BAD_RESPONSE' });
  });
});

describe('starting checkout (BILL-03)', () => {
  it('is unavailable without a provider', async () => {
    const { checkout } = setup(null);
    await assert.rejects(checkout.start(USER, NOW), (error) => {
      assert.equal(statusOf(error), 503);
      assert.equal(codeOf(error), 'CHECKOUT_UNAVAILABLE');
      return true;
    });
  });

  it('refuses a member who already has Pro, from any source', async () => {
    const { checkout, provider } = setup(new FakePaymentProvider(), [heldPro()]);
    await assert.rejects(checkout.start(USER, NOW), (error) => {
      assert.equal(statusOf(error), 409);
      assert.equal(codeOf(error), 'PLAN_ALREADY_PRO');
      return true;
    });
    assert.equal(provider!.opened.length, 0);
  });

  it('opens at the price, back to the plans page, and grants nothing', async () => {
    const { checkout, provider, db } = setup();
    const attempt = await checkout.start(USER, NOW);
    assert.equal(attempt.status, 'PENDING');
    assert.ok(attempt.checkoutUrl);
    assert.equal(provider!.opened[0].amount, PRO_PRICE.amount);
    assert.equal(provider!.opened[0].currency, 'ARS');
    assert.equal(provider!.opened[0].attemptId, attempt.id);
    assert.equal(provider!.opened[0].backUrl, `https://app.example.com/plans?checkout=${attempt.id}`);
    assert.equal(db.state.grants.length, 0);
    assert.equal(db.state.subscriptions.length, 0);
  });

  it('answers a repeated press with the same attempt', async () => {
    const { checkout, provider, db } = setup();
    const first = await checkout.start(USER, NOW);
    const second = await checkout.start(USER, new Date(NOW.getTime() + 60_000));
    assert.equal(second.id, first.id);
    assert.equal(second.checkoutUrl, first.checkoutUrl);
    assert.equal(provider!.opened.length, 1);
    assert.equal(db.state.attempts.length, 1);
  });

  it('asks again for an attempt a crash left without a page, under the same id', async () => {
    const { checkout, provider, db } = setup();
    const first = await checkout.start(USER, NOW);
    Object.assign(db.state.attempts[0], { checkoutUrl: null, externalId: null });
    const second = await checkout.start(USER, NOW);
    assert.equal(second.id, first.id);
    assert.equal(provider!.opened.length, 2);
    assert.equal(provider!.opened[1].attemptId, first.id);
  });

  it('expires a stale attempt and opens a new one', async () => {
    const { checkout, db } = setup();
    const first = await checkout.start(USER, NOW);
    const second = await checkout.start(USER, new Date(NOW.getTime() + 2 * 60 * 60 * 1000));
    assert.notEqual(second.id, first.id);
    assert.equal(db.state.attempts[0].status, 'EXPIRED');
    assert.equal(db.state.attempts[1].status, 'PENDING');
  });

  it('states a provider failure as recoverable, and the next press starts again', async () => {
    const provider = new FakePaymentProvider('AUTHORIZED', undefined, 'PROVIDER_HTTP_500');
    const { checkout, db } = setup(provider);
    await assert.rejects(checkout.start(USER, NOW), (error) => {
      assert.equal(statusOf(error), 502);
      assert.equal(codeOf(error), 'CHECKOUT_PROVIDER_ERROR');
      return true;
    });
    assert.equal(db.state.attempts[0].status, 'FAILED');
    assert.equal(db.state.attempts[0].failureCode, 'PROVIDER_HTTP_500');
    const retried = await checkout.start(USER, NOW);
    assert.equal(retried.status, 'PENDING');
    assert.equal(db.state.attempts.length, 2);
  });

  it('offers a waiting attempt back on the billing read, and never a stale one', async () => {
    const { checkout, db, provider } = setup();
    const attempt = await checkout.start(USER, NOW);
    const offer = await checkoutOffer(db as never, provider, USER.id, NOW);
    assert.equal(offer.available, true);
    assert.equal(offer.testMode, true);
    assert.deepEqual(offer.price, PRO_PRICE);
    assert.equal(offer.pending?.id, attempt.id);
    const later = await checkoutOffer(db as never, provider, USER.id, new Date(NOW.getTime() + 2 * 60 * 60 * 1000));
    assert.equal(later.pending, null);
    const none = await checkoutOffer(db as never, null, USER.id, NOW);
    assert.equal(none.available, false);
    assert.equal(none.testMode, true, 'with no provider the product still never claims real payments');
  });
});

describe('confirming checkout (BILL-03)', () => {
  it('grants Pro from an authorized read, writing all three together', async () => {
    const next = new Date(NOW.getTime() + 30 * DAY);
    const provider = new FakePaymentProvider('AUTHORIZED', () => next);
    const { checkout, db } = setup(provider);
    const attempt = await checkout.start(USER, NOW);
    const done = await checkout.confirm(USER.id, attempt.id, NOW);
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.checkoutUrl, null);
    const [subscription] = db.state.subscriptions;
    // BILL-04: a first subscription starts in its free trial, which ends with the first charge.
    assert.equal(subscription.status, 'TRIALING');
    assert.deepEqual(subscription.trialEndsAt, new Date(NOW.getTime() + 7 * DAY));
    assert.equal(subscription.userId, USER.id);
    assert.equal(subscription.currentPeriodEnd, next);
    const [grant] = db.state.grants;
    assert.equal(grant.source, 'SUBSCRIPTION');
    assert.equal(grant.planId, 'PRO');
    assert.equal(grant.subscriptionId, subscription.id);
    assert.deepEqual(grant.expiresAt, new Date(next.getTime() + 3 * DAY));
  });

  it('grants once however often it is confirmed', async () => {
    const { checkout, db } = setup();
    const attempt = await checkout.start(USER, NOW);
    await checkout.confirm(USER.id, attempt.id, NOW);
    await checkout.confirm(USER.id, attempt.id, NOW);
    assert.equal(db.state.grants.length, 1);
    assert.equal(db.state.subscriptions.length, 1);
  });

  it('grants nothing for returning alone', async () => {
    const provider = new FakePaymentProvider('PENDING');
    const { checkout, db } = setup(provider);
    const attempt = await checkout.start(USER, NOW);
    const waiting = await checkout.confirm(USER.id, attempt.id, NOW);
    assert.equal(waiting.status, 'PENDING');
    assert.ok(waiting.checkoutUrl, 'the member can go back to the page');
    assert.equal(db.state.grants.length, 0);
    provider.outcome = 'AUTHORIZED';
    assert.equal((await checkout.confirm(USER.id, attempt.id, NOW)).status, 'COMPLETED');
  });

  it('closes a cancelled attempt without a grant', async () => {
    const { checkout, db } = setup(new FakePaymentProvider('CANCELLED'));
    const attempt = await checkout.start(USER, NOW);
    assert.equal((await checkout.confirm(USER.id, attempt.id, NOW)).status, 'CANCELED');
    assert.equal(db.state.attempts[0].failureCode, 'PROVIDER_CANCELLED');
    assert.equal(db.state.grants.length, 0);
  });

  it('neither grants nor cancels on an unknown status', async () => {
    const { checkout, db } = setup(new FakePaymentProvider('UNKNOWN'));
    const attempt = await checkout.start(USER, NOW);
    assert.equal((await checkout.confirm(USER.id, attempt.id, NOW)).status, 'PENDING');
    assert.equal(db.state.grants.length, 0);
  });

  it('still honours a payment made after the attempt expired', async () => {
    const { checkout, db } = setup();
    const attempt = await checkout.start(USER, NOW);
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    db.state.attempts[0].status = 'EXPIRED';
    assert.equal((await checkout.confirm(USER.id, attempt.id, later)).status, 'COMPLETED');
    assert.equal(db.state.grants.length, 1);
  });

  it('leaves the attempt alone when the provider cannot be read', async () => {
    const provider = new FakePaymentProvider();
    const { checkout, db } = setup(provider);
    const attempt = await checkout.start(USER, NOW);
    provider.failNext = 'PROVIDER_UNREACHABLE';
    await assert.rejects(checkout.confirm(USER.id, attempt.id, NOW), (error) => {
      assert.equal(statusOf(error), 502);
      assert.equal(codeOf(error), 'CHECKOUT_PROVIDER_ERROR');
      return true;
    });
    assert.equal(db.state.attempts[0].status, 'PENDING');
    assert.equal(db.state.grants.length, 0);
  });

  it("answers another member's attempt as not found", async () => {
    const { checkout } = setup();
    const attempt = await checkout.start(USER, NOW);
    await assert.rejects(checkout.confirm('someone-else', attempt.id, NOW), (error) => {
      assert.equal(statusOf(error), 404);
      return true;
    });
  });

  it('commits nothing when the grant fails', async () => {
    const { checkout, db } = setup();
    const attempt = await checkout.start(USER, NOW);
    db.entitlementGrant.create = async () => {
      throw new Error('disk full');
    };
    await assert.rejects(checkout.confirm(USER.id, attempt.id, NOW), /disk full/);
    assert.equal(db.state.subscriptions.length, 0);
    assert.equal(db.state.attempts[0].status, 'PENDING');
  });
});
