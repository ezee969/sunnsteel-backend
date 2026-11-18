import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { BillingChargesController } from '../src/billing/billing.controller';
import {
  argentinaDateTime,
  argentinaMonthRange,
  chargesCsv,
  previousArgentinaMonth,
} from '../src/billing/charges-report';
import { providerFromEnv } from '../src/billing/checkout-rules';
import { FakePaymentProvider } from '../src/billing/fake-payment-provider';
import { chargeFromPayment, MercadoPagoAdapter } from '../src/billing/mercado-pago.adapter';
import type { ProviderCharge } from '../src/billing/payment-provider';

const MP = { BILLING_PROVIDER: 'mercadopago', MERCADO_PAGO_ACCESS_TOKEN: 'token' };

const charge = (over: Partial<ProviderCharge> = {}): ProviderCharge => ({
  id: '1001',
  createdAt: new Date('2026-12-05T15:30:00Z'),
  approvedAt: new Date('2026-12-05T15:31:00Z'),
  amount: 4999,
  currency: 'ARS',
  status: 'approved',
  description: 'Sunnsteel Pro',
  payerEmail: 'member@example.com',
  ...over,
});

describe('the live switch (BILL-06)', () => {
  it('charges real money only when live is chosen alone, with the webhook secret', () => {
    const live = providerFromEnv({ ...MP, MERCADO_PAGO_LIVE: 'true', MERCADO_PAGO_WEBHOOK_SECRET: 's' });
    assert.ok(live instanceof MercadoPagoAdapter);
    assert.equal(live.testMode, false);
  });

  it('opens nothing for live without the secret, for both flags, or for neither', () => {
    assert.equal(providerFromEnv({ ...MP, MERCADO_PAGO_LIVE: 'true' }), null);
    assert.equal(
      providerFromEnv({
        ...MP,
        MERCADO_PAGO_LIVE: 'true',
        MERCADO_PAGO_SANDBOX: 'true',
        MERCADO_PAGO_WEBHOOK_SECRET: 's',
      }),
      null,
    );
    assert.equal(providerFromEnv({ ...MP, MERCADO_PAGO_WEBHOOK_SECRET: 's' }), null);
    assert.equal(providerFromEnv({ ...MP, MERCADO_PAGO_LIVE: 'yes', MERCADO_PAGO_WEBHOOK_SECRET: 's' }), null);
  });

  it('keeps the sandbox as it was, with or without the secret', () => {
    const sandbox = providerFromEnv({ ...MP, MERCADO_PAGO_SANDBOX: 'true' });
    assert.ok(sandbox instanceof MercadoPagoAdapter);
    assert.equal(sandbox.testMode, true);
  });
});

describe("the month in Argentina's time (BILL-06)", () => {
  it('starts and ends each month at Argentine midnight', () => {
    const december = argentinaMonthRange('2026-12');
    assert.deepEqual(
      [december?.from.toISOString(), december?.to.toISOString()],
      ['2026-12-01T03:00:00.000Z', '2027-01-01T03:00:00.000Z'],
    );
    const february = argentinaMonthRange('2027-02');
    assert.equal(february?.to.toISOString(), '2027-03-01T03:00:00.000Z');
  });

  it('refuses anything but a real YYYY-MM', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-12', '2026-12-01', '', 'abcd-ef', '2019-12']) {
      assert.equal(argentinaMonthRange(bad), null, bad);
    }
  });

  it('defaults to the month before the current one in Argentina', () => {
    // 02:00 UTC on 1 December is still 30 November in Argentina.
    assert.equal(previousArgentinaMonth(new Date('2026-12-01T02:00:00Z')), '2026-10');
    assert.equal(previousArgentinaMonth(new Date('2026-12-01T03:30:00Z')), '2026-11');
    assert.equal(previousArgentinaMonth(new Date('2027-01-15T12:00:00Z')), '2026-12');
  });

  it("writes dates as Argentina's clock reads them", () => {
    assert.equal(argentinaDateTime(new Date('2026-12-01T02:15:00Z')), '2026-11-30 23:15');
  });
});

describe('the charges CSV (BILL-06)', () => {
  it('opens in Spanish Excel: a byte-order mark, semicolons and a decimal comma', () => {
    const csv = chargesCsv([charge()]);
    assert.ok(csv.startsWith('﻿'));
    const [header, row] = csv.slice(1).trimEnd().split('\r\n');
    assert.equal(header, 'fecha;fecha_aprobado;id_pago;descripcion;monto;moneda;estado;email_pagador');
    assert.equal(
      row,
      '2026-12-05 12:30;2026-12-05 12:31;1001;Sunnsteel Pro;4999,00;ARS;aprobado;member@example.com',
    );
  });

  it('lists every charge oldest first, in Spanish, quoting what would break a field', () => {
    const csv = chargesCsv([
      charge({ id: '2', createdAt: new Date('2026-12-20T12:00:00Z'), status: 'refunded' }),
      charge({
        id: '1',
        createdAt: new Date('2026-12-02T12:00:00Z'),
        approvedAt: null,
        status: 'rejected',
        description: 'Pro; "anual"',
        payerEmail: null,
      }),
      charge({ id: '3', createdAt: new Date('2026-12-21T12:00:00Z'), status: 'something_new' }),
    ]);
    const rows = csv.slice(1).trimEnd().split('\r\n').slice(1);
    assert.equal(rows.length, 3);
    assert.equal(rows[0], '2026-12-02 09:00;;1;"Pro; ""anual""";4999,00;ARS;rechazado;');
    assert.match(rows[1], /^2026-12-20 09:00;[^;]*;2;/);
    assert.match(rows[1], /;devuelto;/);
    assert.match(rows[2], /;something_new;/);
  });

  it('is only the header for a month without charges', () => {
    assert.equal(chargesCsv([]).slice(1).trimEnd().split('\r\n').length, 1);
  });
});

describe("Mercado Pago's charges (BILL-06)", () => {
  function pages(...bodies: unknown[]) {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      const body = bodies[urls.length - 1] ?? { results: [], paging: { total: 0 } };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    return { urls, adapter: new MercadoPagoAdapter('t', false, fetchImpl, 'https://mp.test', 's') };
  }
  const payment = (id: number) => ({
    id,
    date_created: '2026-12-05T12:30:00.000-03:00',
    date_approved: '2026-12-05T12:31:00.000-03:00',
    transaction_amount: 4999,
    currency_id: 'ARS',
    status: 'approved',
    description: 'Sunnsteel Pro',
    operation_type: 'regular_payment',
    point_of_interaction: { type: 'SUBSCRIPTIONS', transaction_data: { subscription_id: 'pre-1' } },
    payer: { email: 'member@example.com', identification: { number: '12345678' } },
  });

  it('reads the month page by page, half-open, oldest first', async () => {
    const first = Array.from({ length: 100 }, (_, i) => payment(i + 1));
    const { urls, adapter } = pages(
      { results: first, paging: { total: 101 } },
      { results: [payment(101)], paging: { total: 101 } },
    );
    const range = argentinaMonthRange('2026-12')!;
    const charges = await adapter.listCharges(range.from, range.to);
    assert.equal(charges.length, 101);
    assert.equal(urls.length, 2);
    const query = new URL(urls[0]).searchParams;
    assert.equal(new URL(urls[0]).pathname, '/v1/payments/search');
    assert.equal(query.get('range'), 'date_created');
    assert.equal(query.get('sort'), 'date_created');
    assert.equal(query.get('criteria'), 'asc');
    assert.equal(query.get('begin_date'), '2026-12-01T03:00:00.000Z');
    assert.equal(query.get('end_date'), '2027-01-01T02:59:59.999Z');
    assert.equal(new URL(urls[1]).searchParams.get('offset'), '100');
  });

  it('stops on a short page and keeps only what names a charge', async () => {
    const { urls, adapter } = pages({
      results: [payment(1), { id: 2 }, { date_created: 'x', transaction_amount: 1 }],
      paging: { total: 3 },
    });
    const charges = await adapter.listCharges(new Date(0), new Date());
    assert.equal(urls.length, 1);
    assert.deepEqual(
      charges.map((c) => c.id),
      ['1'],
    );
  });

  it("leaves out what is not a subscription's charge", () => {
    const rest: Record<string, unknown> = { ...payment(9) };
    delete rest.point_of_interaction;
    assert.equal(chargeFromPayment({ ...rest, operation_type: 'card_validation', transaction_amount: 0 }), null);
    assert.equal(
      chargeFromPayment({ ...rest, operation_type: 'account_fund', point_of_interaction: { type: 'UNSPECIFIED' } }),
      null,
    );
    assert.ok(chargeFromPayment({ ...payment(9), status: 'refunded' }));
  });

  it('reads only the payer email of the payer', () => {
    const read = chargeFromPayment(payment(7));
    assert.deepEqual(Object.keys(read ?? {}).sort(), [
      'amount',
      'approvedAt',
      'createdAt',
      'currency',
      'description',
      'id',
      'payerEmail',
      'status',
    ]);
    assert.equal(read?.payerEmail, 'member@example.com');
  });
});

describe('the charges route (BILL-06)', () => {
  function response() {
    const headers: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string) => (headers[name] = value) } as unknown as Response;
    return { headers, res };
  }
  async function status(promise: Promise<unknown>): Promise<number> {
    try {
      await promise;
      return 200;
    } catch (error) {
      assert.ok(error instanceof HttpException);
      return error.getStatus();
    }
  }

  it("answers the month's charges as a download named for the month", async () => {
    const provider = new FakePaymentProvider();
    provider.charges.push(
      charge({ id: 'in', createdAt: new Date('2026-12-31T23:00:00Z') }), // 20:00 on the 31st in Argentina
      charge({ id: 'out', createdAt: new Date('2027-01-01T03:00:00Z') }), // midnight on 1 January
    );
    const { headers, res } = response();
    const csv = await new BillingChargesController(provider).charges('2026-12', res);
    assert.match(csv, /;in;/);
    assert.doesNotMatch(csv, /;out;/);
    assert.equal(headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.equal(headers['Content-Disposition'], 'attachment; filename="cobros-2026-12-sandbox.csv"');
    assert.equal(headers['Cache-Control'], 'no-store');
  });

  it('refuses a bad month, says when there is no provider, and when the provider fails', async () => {
    const provider = new FakePaymentProvider();
    assert.equal(await status(new BillingChargesController(provider).charges('2026-13', response().res)), 400);
    assert.equal(await status(new BillingChargesController(null).charges('2026-12', response().res)), 503);
    provider.failNext = 'PROVIDER_HTTP_500';
    assert.equal(await status(new BillingChargesController(provider).charges('2026-12', response().res)), 502);
  });

  it('defaults to the previous month', async () => {
    const { headers, res } = response();
    await new BillingChargesController(new FakePaymentProvider()).charges(undefined, res);
    assert.match(headers['Content-Disposition'], /cobros-\d{4}-\d{2}-sandbox\.csv/);
  });
});
