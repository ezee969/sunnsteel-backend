import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { HttpException } from '@nestjs/common';
import { SUBSCRIPTION_GRACE_DAYS, SUBSCRIPTION_TRIAL_DAYS } from '@sunsteel/contracts';
import { checkoutOffer, CheckoutService } from '../src/billing/checkout.service';
import { FakePaymentProvider } from '../src/billing/fake-payment-provider';
import {
  mercadoPagoSignatureValid,
  MercadoPagoAdapter,
  preapprovalPaymentState,
} from '../src/billing/mercado-pago.adapter';
import { ProviderNotificationsService } from '../src/billing/provider-notifications.service';
import {
  enteredGracePeriod,
  graceEnd,
  nextSubscriptionState,
  type StoredSubscription,
} from '../src/billing/subscription-lifecycle';
import { SubscriptionSyncService } from '../src/billing/subscription-sync.service';
import type { DatabaseService } from '../src/database/database.service';
import type { JobsService } from '../src/jobs/jobs.service';
import { memoryDb, NOW } from './billing-memory-db';

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const USER = { id: 'member-1', email: 'member@example.com' };

const stored = (over: Partial<StoredSubscription> = {}): StoredSubscription => ({
  status: 'ACTIVE',
  currentPeriodEnd: at(20),
  trialEndsAt: null,
  pastDueSince: null,
  cancelAtPeriodEnd: false,
  ...over,
});

function codeOf(error: unknown): string | undefined {
  return ((error as HttpException).getResponse() as { code?: string }).code;
}

describe('the subscription lifecycle (BILL-04)', () => {
  const authorized = { status: 'AUTHORIZED' as const, nextPaymentAt: at(30), paymentState: 'OK' as const };

  it('starts a first subscription in its trial, and a later one active', () => {
    const trial = nextSubscriptionState(null, { ...authorized, nextPaymentAt: at(7) }, NOW, at(7));
    assert.equal(trial.kind, 'APPLY');
    assert.equal(trial.kind === 'APPLY' && trial.next.status, 'TRIALING');
    assert.deepEqual(trial.kind === 'APPLY' && trial.grant, { expiresAt: at(10) });
    const paid = nextSubscriptionState(null, authorized, NOW);
    assert.equal(paid.kind === 'APPLY' && paid.next.status, 'ACTIVE');
  });

  it('becomes active when the trial ends and the provider charged', () => {
    const decision = nextSubscriptionState(stored({ status: 'TRIALING', trialEndsAt: at(-1) }), authorized, NOW);
    assert.equal(decision.kind === 'APPLY' && decision.next.status, 'ACTIVE');
    assert.deepEqual(decision.kind === 'APPLY' && decision.grant, { expiresAt: at(33) });
  });

  it('keeps Pro for the grace period from the first failed renewal, then ends it', () => {
    const failing = { ...authorized, paymentState: 'FAILING' as const };
    const first = nextSubscriptionState(stored(), failing, NOW);
    assert.equal(first.kind === 'APPLY' && first.next.status, 'PAST_DUE');
    assert.deepEqual(first.kind === 'APPLY' && first.next.pastDueSince, NOW);
    assert.deepEqual(first.kind === 'APPLY' && first.grant, { expiresAt: at(SUBSCRIPTION_GRACE_DAYS) });
    assert.equal(enteredGracePeriod(stored(), first), true);

    const later = nextSubscriptionState(stored({ status: 'PAST_DUE', pastDueSince: NOW }), failing, at(3));
    assert.deepEqual(later.kind === 'APPLY' && later.next.pastDueSince, NOW, 'the grace period never restarts');
    assert.equal(enteredGracePeriod(stored({ status: 'PAST_DUE', pastDueSince: NOW }), later), false);

    const over = nextSubscriptionState(stored({ status: 'PAST_DUE', pastDueSince: NOW }), failing, at(SUBSCRIPTION_GRACE_DAYS));
    assert.equal(over.kind === 'APPLY' && over.grant, 'REVOKE');
  });

  it('returns to active when a retry succeeds', () => {
    const decision = nextSubscriptionState(stored({ status: 'PAST_DUE', pastDueSince: at(-2) }), authorized, NOW);
    assert.equal(decision.kind === 'APPLY' && decision.next.status, 'ACTIVE');
    assert.equal(decision.kind === 'APPLY' && decision.next.pastDueSince, null);
  });

  it('never leaves the grace period on a read that says nothing about payment', () => {
    const decision = nextSubscriptionState(
      stored({ status: 'PAST_DUE', pastDueSince: at(-2) }),
      { ...authorized, paymentState: 'UNKNOWN' },
      NOW,
    );
    assert.equal(decision.kind, 'KEEP');
  });

  it('cancels at the end of what was paid, or of the grace period', () => {
    for (const status of ['CANCELLED', 'PAUSED'] as const) {
      const view = { status, nextPaymentAt: null, paymentState: 'UNKNOWN' as const };
      const paid = nextSubscriptionState(stored(), view, NOW);
      assert.equal(paid.kind === 'APPLY' && paid.next.status, 'CANCELED');
      assert.equal(paid.kind === 'APPLY' && paid.next.cancelAtPeriodEnd, true);
      assert.deepEqual(paid.kind === 'APPLY' && paid.grant, { expiresAt: at(20) });
      const pastDue = nextSubscriptionState(stored({ status: 'PAST_DUE', pastDueSince: at(-2) }), view, NOW);
      assert.deepEqual(pastDue.kind === 'APPLY' && pastDue.grant, { expiresAt: graceEnd(at(-2)) });
      assert.deepEqual(pastDue.kind === 'APPLY' && pastDue.next.currentPeriodEnd, graceEnd(at(-2)), 'the card names the same day');
      // A trial cancelled before its first charge: Pro ends with the trial,
      // even when the provider dates that charge later.
      const trial = nextSubscriptionState(stored({ status: 'TRIALING', trialEndsAt: at(5), currentPeriodEnd: at(30) }), view, NOW);
      assert.deepEqual(trial.kind === 'APPLY' && trial.grant, { expiresAt: at(5) });
      assert.deepEqual(trial.kind === 'APPLY' && trial.next.currentPeriodEnd, at(5));
      // Still marked TRIALING after the trial ended: charged, so what was paid.
      const charged = nextSubscriptionState(stored({ status: 'TRIALING', trialEndsAt: at(-1), currentPeriodEnd: at(29) }), view, NOW);
      assert.deepEqual(charged.kind === 'APPLY' && charged.grant, { expiresAt: at(29) });
      const over = nextSubscriptionState(stored({ currentPeriodEnd: at(-1) }), view, NOW);
      assert.equal(over.kind === 'APPLY' && over.grant, 'REVOKE');
    }
  });

  it('decides nothing on a read that says nothing, after a cancellation, or before authorization', () => {
    for (const status of ['PENDING', 'UNKNOWN'] as const) {
      assert.equal(nextSubscriptionState(stored(), { status, nextPaymentAt: null, paymentState: 'UNKNOWN' }, NOW).kind, 'KEEP');
    }
    assert.equal(nextSubscriptionState(stored({ status: 'CANCELED' }), authorized, NOW).kind, 'KEEP');
    assert.equal(
      nextSubscriptionState(null, { status: 'CANCELLED', nextPaymentAt: null, paymentState: 'UNKNOWN' }, NOW).kind,
      'KEEP',
    );
  });
});

describe('Mercado Pago notifications and calls (BILL-04)', () => {
  const secret = 'webhook-secret';
  const sign = (dataId: string, requestId: string, ts: string) =>
    createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  const incoming = (signature: string, dataId = 'ABC123') => ({
    headers: { 'x-signature': signature, 'x-request-id': 'req-1' },
    query: { 'data.id': dataId, type: 'subscription_preapproval' },
    body: { id: 987, type: 'subscription_preapproval', data: { id: dataId } },
  });

  it('accepts only a notification signed with the webhook secret', () => {
    const good = incoming(`ts=1700000000,v1=${sign('abc123', 'req-1', '1700000000')}`);
    assert.equal(mercadoPagoSignatureValid(good, secret), true, 'an alphanumeric id is signed lowercased');
    assert.equal(mercadoPagoSignatureValid(good, 'another-secret'), false);
    assert.equal(mercadoPagoSignatureValid(incoming(`ts=1700000001,v1=${sign('abc123', 'req-1', '1700000000')}`), secret), false);
    assert.equal(mercadoPagoSignatureValid(incoming('ts=1700000000'), secret), false);
    assert.equal(mercadoPagoSignatureValid({ ...good, headers: {} }, secret), false);

    const adapter = new MercadoPagoAdapter('token', true, fetch, 'https://mp.test', secret);
    assert.deepEqual(adapter.parseNotification(good), {
      externalEventId: '987',
      topic: 'subscription_preapproval',
      resourceId: 'ABC123',
    });
    const unsigned = new MercadoPagoAdapter('token', true, fetch, 'https://mp.test', null);
    assert.equal(unsigned.parseNotification(good), null, 'no secret, no notification');
  });

  it('reads whether a renewal went through from the semaphore', () => {
    assert.equal(preapprovalPaymentState({ semaphore: 'green' }), 'OK');
    assert.equal(preapprovalPaymentState({ semaphore: 'yellow' }), 'FAILING');
    assert.equal(preapprovalPaymentState({ semaphore: 'red' }), 'FAILING');
    assert.equal(preapprovalPaymentState({}), 'UNKNOWN');
    assert.equal(preapprovalPaymentState(null), 'UNKNOWN');
  });

  it('opens a trial, cancels and finds the subscription behind a payment', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers: Record<string, unknown> = {
      'POST https://mp.test/preapproval': { id: 'pre-1', init_point: 'https://mp.test/pay' },
      'PUT https://mp.test/preapproval/pre-1': { id: 'pre-1', status: 'cancelled' },
      'GET https://mp.test/authorized_payments/77': { id: 77, preapproval_id: 'pre-1' },
    };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(answers[`${init.method} ${url}`] ?? {}), { status: 200 });
    }) as unknown as typeof fetch;
    const adapter = new MercadoPagoAdapter('token', true, fetchImpl, 'https://mp.test', secret);
    await adapter.openSubscriptionCheckout({
      attemptId: 'a',
      payerEmail: 'p@x.com',
      reason: 'Sunnsteel Pro',
      amount: 4999,
      currency: 'ARS',
      backUrl: 'https://app/plans?checkout=a',
      trialDays: SUBSCRIPTION_TRIAL_DAYS,
    });
    const recurring = JSON.parse(calls[0].init.body as string).auto_recurring;
    assert.deepEqual(recurring.free_trial, { frequency: SUBSCRIPTION_TRIAL_DAYS, frequency_type: 'days' });
    await adapter.cancelSubscription('pre-1');
    assert.equal(calls[1].init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1].init.body as string), { status: 'cancelled' });
    assert.equal(
      await adapter.subscriptionIdFor({ externalEventId: '1', topic: 'subscription_authorized_payment', resourceId: '77' }),
      'pre-1',
    );
    assert.equal(await adapter.subscriptionIdFor({ externalEventId: '2', topic: 'payment', resourceId: '77' }), null);
  });
});

describe('keeping subscriptions current (BILL-04)', () => {
  function setup(provider = new FakePaymentProvider('AUTHORIZED', () => at(30))) {
    const db = memoryDb();
    const sync = new SubscriptionSyncService(db as unknown as DatabaseService, provider);
    const checkout = new CheckoutService(db as unknown as DatabaseService, provider, { FRONTEND_URL: 'https://app' }, sync);
    return { db, provider, sync, checkout };
  }
  async function subscribed() {
    const env = setup();
    const attempt = await env.checkout.start(USER, NOW);
    await env.checkout.confirm(USER.id, attempt.id, NOW);
    return { ...env, subscription: env.db.state.subscriptions[0] };
  }

  it('opens a first subscription with the trial, and never another', async () => {
    const { db, provider, sync, subscription } = await subscribed();
    assert.equal(provider.opened[0].trialDays, SUBSCRIPTION_TRIAL_DAYS);
    assert.equal(subscription.status, 'TRIALING');
    assert.equal(await sync.trialDaysFor(db as never, USER.id), null);
    const offer = await checkoutOffer(db as never, provider, USER.id, NOW);
    assert.equal(offer.trialDays, null);
    const fresh = await checkoutOffer(memoryDb() as never, provider, USER.id, NOW);
    assert.equal(fresh.trialDays, SUBSCRIPTION_TRIAL_DAYS);
  });

  it('writes nothing new when a daily read finds nothing changed', async () => {
    const { db, sync, subscription } = await subscribed();
    await sync.sync(subscription as never, at(1));
    await sync.sync(subscription as never, at(2));
    assert.equal(db.state.grants.length, 1);
    assert.equal(db.state.notifications.length, 0);
  });

  it('enters the grace period once, tells the member once, and leaves it on a successful retry', async () => {
    const { db, provider, sync, subscription } = await subscribed();
    provider.paymentState = 'FAILING';
    await sync.sync(subscription as never, at(8));
    await sync.sync(subscription as never, at(9));
    assert.equal(subscription.status, 'PAST_DUE');
    assert.deepEqual(subscription.pastDueSince, at(8));
    assert.equal(db.state.notifications.length, 1);
    const [notice] = db.state.notifications;
    assert.equal(notice.kind, 'SUBSCRIPTION_PAYMENT_FAILED');
    assert.equal((notice.payload as { graceEndsAt: string }).graceEndsAt, graceEnd(at(8)).toISOString());
    const open = db.state.grants.find((g) => g.revokedAt === null);
    assert.deepEqual(open?.expiresAt, graceEnd(at(8)));

    provider.paymentState = 'OK';
    await sync.sync(subscription as never, at(10));
    assert.equal(subscription.status, 'ACTIVE');
    assert.equal(subscription.pastDueSince, null);
  });

  it('ends Pro when the grace period runs out, and deletes nothing', async () => {
    const { db, provider, sync, subscription } = await subscribed();
    provider.paymentState = 'FAILING';
    await sync.sync(subscription as never, at(8));
    await sync.sync(subscription as never, at(8 + SUBSCRIPTION_GRACE_DAYS + 1));
    assert.equal(db.state.grants.filter((g) => g.revokedAt === null).length, 0);
    assert.equal(db.state.subscriptions.length, 1, 'the subscription stays as the record');
  });

  it('cancels at the provider and keeps Pro to the end of what was paid', async () => {
    const { db, provider, sync, subscription } = await subscribed();
    await sync.cancel(USER.id, at(2));
    assert.ok(provider.cancelled.has(subscription.externalId as string));
    assert.equal(subscription.status, 'CANCELED');
    assert.equal(subscription.cancelAtPeriodEnd, true);
    const open = db.state.grants.find((g) => g.revokedAt === null);
    assert.deepEqual(open?.expiresAt, subscription.currentPeriodEnd);
    await assert.rejects(sync.cancel(USER.id, at(3)), (error) => codeOf(error) === 'SUBSCRIPTION_NOT_ACTIVE');
  });

  it('changes nothing when the provider cannot cancel', async () => {
    const { provider, sync, subscription } = await subscribed();
    provider.failNext = 'PROVIDER_UNREACHABLE';
    await assert.rejects(sync.cancel(USER.id, at(2)), (error) => codeOf(error) === 'CHECKOUT_PROVIDER_ERROR');
    assert.equal(subscription.status, 'TRIALING');
  });

  it('reconciles every subscription that can still change, one failure not stopping the rest', async () => {
    const { db, provider, sync, subscription } = await subscribed();
    provider.seed({ externalId: 'fake-other', status: 'AUTHORIZED', externalReference: null, nextPaymentAt: null, paymentState: 'OK' });
    db.state.subscriptions.push(
      { ...subscription, id: 'second', userId: 'member-2', externalId: 'fake-missing', lastSyncedAt: null },
      { ...subscription, id: 'third', userId: 'member-3', externalId: 'fake-other', status: 'CANCELED' },
    );
    const result = await sync.reconcileAll(at(1));
    assert.deepEqual(result, { read: 2, failed: 1 }, 'the cancelled one is not read; the missing one fails alone');
    assert.deepEqual(subscription.lastSyncedAt, at(1));
  });

  it('cancels at the provider before an account is deleted, and never blocks it', async () => {
    const { provider, sync, subscription } = await subscribed();
    await sync.cancelForDeletion(USER.id);
    assert.ok(provider.cancelled.has(subscription.externalId as string));
    const failing = await subscribed();
    failing.provider.failNext = 'PROVIDER_UNREACHABLE';
    await failing.sync.cancelForDeletion(USER.id);
  });

  it('leaves a subscription of another provider alone', async () => {
    const { sync, subscription } = await subscribed();
    assert.equal(await sync.sync({ ...subscription, provider: 'MERCADO_PAGO' } as never, at(1)), 'PROVIDER_NOT_CONFIGURED');
  });
});

describe('the provider notification inbox (BILL-04)', () => {
  function setup() {
    const db = memoryDb();
    const provider = new FakePaymentProvider('AUTHORIZED', () => at(30));
    const sync = new SubscriptionSyncService(db as unknown as DatabaseService, provider);
    const checkout = new CheckoutService(db as unknown as DatabaseService, provider, { FRONTEND_URL: 'https://app' }, sync);
    const consumed: string[] = [];
    const jobs = { consume: (topic: string) => consumed.push(topic) } as unknown as JobsService;
    const inbox = new ProviderNotificationsService(db as unknown as DatabaseService, jobs, sync, provider);
    return { db, provider, checkout, inbox, consumed };
  }
  const signed = (id: string, resourceId: string) => ({
    headers: { 'x-fake-signature': 'fake' },
    query: {},
    body: { id, type: 'subscription_preapproval', data: { id: resourceId } },
  });

  it('refuses an unsigned notification and stores nothing', async () => {
    const { db, inbox } = setup();
    await assert.rejects(
      inbox.receive('fake', { headers: {}, query: {}, body: { id: 'e1', type: 'subscription_preapproval' } }),
      (error) => (error as HttpException).getStatus() === 401,
    );
    await assert.rejects(inbox.receive('mercadopago', signed('e1', 'x')), (error) => (error as HttpException).getStatus() === 404);
    assert.equal(db.state.providerNotifications.length, 0);
    assert.equal(db.state.outbox.length, 0);
  });

  it('stores one delivered twice once, with its outbox message', async () => {
    const { db, inbox, consumed } = setup();
    inbox.onModuleInit();
    assert.deepEqual(consumed, ['billing.provider-notification']);
    await inbox.receive('fake', signed('e1', 'pre-1'));
    await inbox.receive('fake', signed('e1', 'pre-1'));
    assert.equal(db.state.providerNotifications.length, 1);
    assert.equal(db.state.outbox.length, 1);
    assert.deepEqual(db.state.outbox[0].payload, { notificationId: db.state.providerNotifications[0].id });
  });

  it('starts Pro from a notification read back from the provider, once', async () => {
    const { db, checkout, inbox } = setup();
    const attempt = await checkout.start(USER, NOW);
    const externalId = db.state.attempts[0].externalId as string;
    await inbox.receive('fake', signed('e2', externalId));
    const id = db.state.providerNotifications[0].id as string;
    await db.$transaction((tx) => inbox.handle(tx as never, id, NOW));
    await db.$transaction((tx) => inbox.handle(tx as never, id, NOW));
    assert.equal(db.state.attempts[0].status, 'COMPLETED');
    assert.equal(db.state.subscriptions.length, 1);
    assert.equal(db.state.grants.length, 1);
    assert.equal(db.state.providerNotifications[0].outcome, 'ATTEMPT_COMPLETED');
    assert.ok(db.state.providerNotifications[0].processedAt);
    assert.equal(attempt.status, 'PENDING', 'nothing was granted at opening');
  });

  it('records a notification about nothing it holds, and grants nothing', async () => {
    const { db, provider, inbox } = setup();
    provider.seed({ externalId: 'stranger', status: 'AUTHORIZED', externalReference: null, nextPaymentAt: null, paymentState: 'OK' });
    await inbox.receive('fake', signed('e3', 'stranger'));
    await db.$transaction((tx) => inbox.handle(tx as never, db.state.providerNotifications[0].id as string, NOW));
    assert.equal(db.state.providerNotifications[0].outcome, 'UNKNOWN_SUBSCRIPTION');
    assert.equal(db.state.grants.length, 0);
  });
});
