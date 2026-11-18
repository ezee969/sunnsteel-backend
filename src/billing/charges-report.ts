import type { ProviderCharge } from './payment-provider';

/**
 * BILL-06: the monthly list of charges the owner invoices from. A monotributista
 * issues a Factura C for every charge, dated as Argentina dates it, so the
 * month and every date here are Argentina's (UTC-3 all year: Argentina keeps
 * no daylight-saving time).
 */
const ARGENTINA_OFFSET = '-03:00';
const BOM = String.fromCharCode(0xfeff);
const ARGENTINA_OFFSET_MS = -3 * 60 * 60 * 1000;

/** `YYYY-MM` from 2020 on; the month must exist. */
const MONTH = /^(20[2-9]\d)-(0[1-9]|1[0-2])$/;

/** The month `YYYY-MM` as `[from, to)` in Argentina, or null for anything else. */
export function argentinaMonthRange(month: string): { from: Date; to: Date } | null {
  const match = MONTH.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]);
  const next = index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`;
  return {
    from: new Date(`${month}-01T00:00:00${ARGENTINA_OFFSET}`),
    to: new Date(`${next}-01T00:00:00${ARGENTINA_OFFSET}`),
  };
}

/** The month before the one `now` falls in, in Argentina: the one usually invoiced. */
export function previousArgentinaMonth(now: Date): string {
  const local = new Date(now.getTime() + ARGENTINA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth(); // 0-based, so this is already the previous month's 1-based number
  return month === 0 ? `${year - 1}-12` : `${year}-${String(month).padStart(2, '0')}`;
}

/** `YYYY-MM-DD HH:MM` in Argentina. */
export function argentinaDateTime(date: Date): string {
  return new Date(date.getTime() + ARGENTINA_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

const STATUS_ES: Record<string, string> = {
  approved: 'aprobado',
  authorized: 'autorizado',
  pending: 'pendiente',
  in_process: 'en proceso',
  in_mediation: 'en mediación',
  rejected: 'rechazado',
  cancelled: 'cancelado',
  refunded: 'devuelto',
  charged_back: 'contracargo',
};

/** Excel in Spanish reads `;` between fields and `,` in a decimal. */
function field(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function amountText(amount: number): string {
  return amount.toFixed(2).replace('.', ',');
}

export const CHARGES_CSV_HEADER = [
  'fecha',
  'fecha_aprobado',
  'id_pago',
  'descripcion',
  'monto',
  'moneda',
  'estado',
  'email_pagador',
] as const;

/**
 * The CSV, oldest first, with a byte-order mark so Excel opens the accents
 * right. Every charge is listed whatever its status: an approved one is
 * invoiced, a refunded one needs a credit note, the rest are for reference.
 */
export function chargesCsv(charges: ProviderCharge[]): string {
  const rows = [...charges]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((charge) =>
      [
        argentinaDateTime(charge.createdAt),
        charge.approvedAt ? argentinaDateTime(charge.approvedAt) : '',
        charge.id,
        charge.description ?? '',
        amountText(charge.amount),
        charge.currency,
        STATUS_ES[charge.status] ?? charge.status,
        charge.payerEmail ?? '',
      ]
        .map(field)
        .join(';'),
    );
  return `${BOM}${[CHARGES_CSV_HEADER.join(';'), ...rows].join('\r\n')}\r\n`;
}
