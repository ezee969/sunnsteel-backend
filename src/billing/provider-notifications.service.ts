import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { writeOutbox } from '../jobs/outbox';
import {
  PAYMENT_PROVIDER,
  type IncomingNotification,
  type PaymentProvider,
} from './payment-provider';
import { SubscriptionSyncService } from './subscription-sync.service';

/** The outbox topic a stored provider notification is handled through. */
export const PROVIDER_NOTIFICATION_TOPIC = 'billing.provider-notification';

/**
 * BILL-04: the provider's notifications. Receiving one is two steps, and only
 * the first happens inside the request:
 *
 * 1. `receive` checks the signature (an unsigned or forged notification is
 *    refused and never stored), then writes the `ProviderNotification` row and
 *    its outbox message in one transaction and answers. The row is unique per
 *    provider event, so one delivered twice writes nothing the second time.
 * 2. The outbox consumer (PLAT-01) finds the subscription the notification is
 *    about and **reads the provider for its current state** -- a notification
 *    says that something changed, never what to grant -- and applies that
 *    read through `SubscriptionSyncService`, in the consumer's transaction,
 *    so its effect happens once. A consumer that fails is retried, then
 *    dead-lettered and redriven with `npm run jobs:replay`.
 */
@Injectable()
export class ProviderNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(ProviderNotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly sync: SubscriptionSyncService,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null = null,
  ) {}

  onModuleInit(): void {
    this.jobs.consume<{ notificationId: string }>(PROVIDER_NOTIFICATION_TOPIC, (tx, message) =>
      this.handle(tx, message.payload.notificationId),
    );
  }

  /** `POST /billing/webhooks/:provider`. */
  async receive(providerName: string, incoming: IncomingNotification): Promise<{ received: true }> {
    const provider = this.provider;
    if (!provider || provider.id.toLowerCase().replace(/_/g, '') !== providerName.toLowerCase()) {
      throw new NotFoundException();
    }
    const event = provider.parseNotification(incoming);
    if (!event) throw new UnauthorizedException();
    const id = randomUUID();
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.providerNotification.createMany({
        data: [
          {
            id,
            provider: provider.id,
            externalEventId: event.externalEventId,
            topic: event.topic,
            resourceId: event.resourceId,
            payload: (incoming.body ?? {}) as Prisma.InputJsonValue,
          },
        ],
        skipDuplicates: true,
      });
      if (count === 0) return;
      await writeOutbox(tx, {
        topic: PROVIDER_NOTIFICATION_TOPIC,
        payload: { notificationId: id },
        dedupeKey: `provider-notification:${provider.id}:${event.externalEventId}`,
      });
    });
    return { received: true };
  }

  /** The consumer: what the notification is about, read from the provider and applied. */
  async handle(tx: Prisma.TransactionClient, notificationId: string, now: Date = new Date()): Promise<void> {
    const notification = await tx.providerNotification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.processedAt) return;
    const provider = this.provider;
    let outcome: string;
    if (!provider || provider.id !== notification.provider) {
      outcome = 'PROVIDER_NOT_CONFIGURED';
    } else {
      const externalId = await provider.subscriptionIdFor({
        externalEventId: notification.externalEventId,
        topic: notification.topic,
        resourceId: notification.resourceId,
      });
      if (!externalId) {
        outcome = 'NOT_A_SUBSCRIPTION';
      } else {
        const read = await provider.readSubscription(externalId);
        outcome = await this.sync.applyExternal(tx, provider.id, externalId, read, now);
      }
    }
    await tx.providerNotification.update({
      where: { id: notification.id },
      data: { processedAt: now, outcome: outcome.slice(0, 100) },
    });
    this.logger.log(`Provider notification ${notification.topic}: ${outcome}`);
  }
}
