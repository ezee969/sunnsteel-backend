import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ConsumerRequest } from '@prisma/client';
import {
  apiError,
  CONSUMER_REQUESTS_LIST_MAX,
  consumerRequestProblems,
  normalizeConsumerRequest,
  type ConsumerRequestReceipt,
  type ConsumerRequestSummary,
  type CreateConsumerRequest,
} from '@sunsteel/contracts';
import { DatabaseService } from '../database/database.service';
import { consumerRequestCode } from './consumer-request-code';

/** A code that collides with a stored one is drawn again this many times. */
const CODE_RETRIES = 3;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function toConsumerRequestSummary(row: ConsumerRequest): ConsumerRequestSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    code: row.code,
    name: row.name,
    email: row.email,
    reference: row.reference,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
    handledAt: row.handledAt ? row.handledAt.toISOString() : null,
  };
}

/**
 * BILL-07: the botón de arrepentimiento and the botón de baja. Anyone may ask,
 * without an account, and is answered at once with a code; the request and a
 * notice to every moderator are written together, so a request is never
 * stored unseen. The owner then cancels and refunds by hand in Mercado Pago
 * and marks it done. Nothing here cancels or refunds: a request names an
 * email, and an email proves nobody's identity.
 */
@Injectable()
export class ConsumerRequestsService {
  constructor(private readonly db: DatabaseService) {}

  async create(input: CreateConsumerRequest, now: Date = new Date()): Promise<ConsumerRequestReceipt> {
    const request = normalizeConsumerRequest(input);
    if (consumerRequestProblems(request).length > 0) {
      throw new BadRequestException(apiError('CONSUMER_REQUEST_INVALID'));
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        const row = await this.db.$transaction(async (tx) => {
          const created = await tx.consumerRequest.create({
            data: {
              code: consumerRequestCode(request.kind),
              kind: request.kind,
              name: request.name,
              email: request.email,
              reference: request.reference ?? null,
              details: request.details ?? null,
              createdAt: now,
            },
          });
          const moderators = await tx.user.findMany({ where: { isModerator: true }, select: { id: true } });
          if (moderators.length > 0) {
            await tx.notification.createMany({
              data: moderators.map((moderator) => ({
                userId: moderator.id,
                kind: 'CONSUMER_REQUEST' as const,
                sourceKey: `consumer-request:${created.id}`,
                payload: { requestKind: created.kind, code: created.code },
                createdAt: now,
              })),
              skipDuplicates: true,
            });
          }
          return created;
        });
        return { kind: row.kind, code: row.code, createdAt: row.createdAt.toISOString() };
      } catch (error) {
        if (isUniqueViolation(error) && attempt < CODE_RETRIES) continue;
        throw error;
      }
    }
  }

  /** Open requests first, then the newest. */
  async list(): Promise<ConsumerRequestSummary[]> {
    const rows = await this.db.consumerRequest.findMany({
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
      take: CONSUMER_REQUESTS_LIST_MAX,
    });
    return rows.map(toConsumerRequestSummary);
  }

  /** Marks a request handled; marking one already done changes nothing. */
  async markDone(id: string, now: Date = new Date()): Promise<ConsumerRequestSummary> {
    await this.db.consumerRequest.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'DONE', handledAt: now },
    });
    const row = await this.db.consumerRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Request not found');
    return toConsumerRequestSummary(row);
  }
}
