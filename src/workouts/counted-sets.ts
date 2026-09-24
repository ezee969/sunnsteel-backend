import { Prisma } from '@prisma/client';

/**
 * LIVE-12: the one filter for a set log that counts as work -- completed and
 * not a warm-up. Every read of completed training uses it (or, in raw SQL,
 * `COUNTED_SET_LOG_SQL` over a `logs` alias), so a warm-up can never reach a
 * total, a record, a comparison or a signal through a reader that forgot.
 */
export const COUNTED_SET_LOG = {
  isCompleted: true,
  kind: { not: 'WARMUP' },
} as const satisfies Prisma.SetLogWhereInput;

export const COUNTED_SET_LOG_SQL = Prisma.sql`logs."isCompleted" AND logs."kind" <> 'WARMUP'`;
