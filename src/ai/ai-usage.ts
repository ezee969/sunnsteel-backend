import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

/**
 * INTEL-03: what a model call costs, a member's monthly use and the month's
 * cost ceiling. `INTEL-04` reuses all of it under its own feature key. The
 * month is a UTC calendar month and the ceiling covers every feature.
 */

/** US dollars per million tokens. A model without a price cannot be used. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  // What a declined request may fall back to.
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
};

export const AI_MONTHLY_CEILING_USD_DEFAULT = 20;

/** A reservation stops counting against a member's quota after this long. */
export const AI_PENDING_MINUTES = 10;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function isPricedModel(model: string): boolean {
  return model in PRICES;
}

/** Millionths of a dollar, rounded up; a dollar per million tokens is one each. */
export function costMicros(model: string, usage: TokenUsage): number {
  const price = PRICES[model];
  if (!price) throw new Error(`No price for model ${model}`);
  return Math.ceil(
    usage.inputTokens * price.input + usage.outputTokens * price.output,
  );
}

export function monthRange(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export type ReservationRefusal = 'QUOTA_REACHED' | 'PAUSED';

/**
 * What stands between a member and one more call. The member's own month is
 * named first: a member with nothing left cannot use a resumed ceiling either.
 */
export function usageRefusal(input: {
  used: number;
  limit: number;
  spentMicros: number;
  reserveMicros: number;
  ceilingMicros: number;
}): ReservationRefusal | null {
  if (input.used >= input.limit) return 'QUOTA_REACHED';
  if (input.spentMicros + input.reserveMicros > input.ceilingMicros) return 'PAUSED';
  return null;
}

export interface ReservationRequest {
  userId: string;
  feature: string;
  model: string;
  /** The most the whole request can cost. */
  reserveMicros: number;
  limit: number;
  now?: Date;
}

export type Reservation =
  { id: string; refusal: null } | { id: null; refusal: ReservationRefusal };

/** One id, so reservations of every feature wait for each other. */
const LEDGER_LOCK = 'ai-usage-ledger';

type LedgerDb = Pick<DatabaseService, 'aiUsageRecord'>;

@Injectable()
export class AiUsageService {
  private readonly ceilingMicros: number;

  constructor(
    private readonly db: DatabaseService,
    config: ConfigService,
  ) {
    const dollars = Number(config.get<string>('AI_MONTHLY_CEILING_USD'));
    this.ceilingMicros =
      (Number.isFinite(dollars) && dollars > 0
        ? dollars
        : AI_MONTHLY_CEILING_USD_DEFAULT) * 1_000_000;
  }

  /**
   * A member's month: every delivered result, plus any still being written so
   * two tabs cannot both take the last one. A reservation a crash left behind
   * stops counting here, and its cost stays held against the ceiling.
   */
  private used(
    db: LedgerDb,
    userId: string,
    feature: string,
    now: Date,
  ): Promise<number> {
    const { from, to } = monthRange(now);
    const pendingFrom = new Date(now.getTime() - AI_PENDING_MINUTES * 60_000);
    return db.aiUsageRecord.count({
      where: {
        userId,
        feature,
        createdAt: { gte: from, lt: to },
        OR: [
          { status: 'DELIVERED' },
          { status: 'PENDING', createdAt: { gte: pendingFrom } },
        ],
      },
    });
  }

  private async spent(db: LedgerDb, now: Date): Promise<number> {
    const { from, to } = monthRange(now);
    const sum = await db.aiUsageRecord.aggregate({
      where: { createdAt: { gte: from, lt: to } },
      _sum: { costMicros: true },
    });
    return sum._sum.costMicros ?? 0;
  }

  private async standing(db: LedgerDb, request: Omit<ReservationRequest, 'model'>, now: Date) {
    const used = await this.used(db, request.userId, request.feature, now);
    const spentMicros = await this.spent(db, now);
    const refusal = usageRefusal({
      used,
      limit: request.limit,
      spentMicros,
      reserveMicros: request.reserveMicros,
      ceilingMicros: this.ceilingMicros,
    });
    return { used, refusal };
  }

  /** The member's month and what would refuse one more call now. */
  read(request: Omit<ReservationRequest, 'model'>) {
    return this.standing(this.db, request, request.now ?? new Date());
  }

  /**
   * Checks the member's month and the ceiling and writes the reservation in
   * one locked transaction, so racing requests are decided one at a time.
   */
  async reserve(request: ReservationRequest): Promise<Reservation> {
    const now = request.now ?? new Date();
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEDGER_LOCK}))`;
      const { refusal } = await this.standing(tx, request, now);
      if (refusal) return { id: null, refusal };
      const row = await tx.aiUsageRecord.create({
        data: {
          userId: request.userId,
          feature: request.feature,
          model: request.model,
          costMicros: request.reserveMicros,
          createdAt: now,
        },
        select: { id: true },
      });
      return { id: row.id, refusal: null };
    });
  }

  /** Replaces the reservation with what the call really cost. */
  async settle(
    id: string,
    result: {
      status: 'DELIVERED' | 'NOT_TRAINING' | 'FAILED';
      model: string;
      usage: TokenUsage;
      costMicros: number;
    },
  ): Promise<void> {
    await this.db.aiUsageRecord.update({
      where: { id },
      data: {
        status: result.status,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costMicros: result.costMicros,
      },
    });
  }
}
