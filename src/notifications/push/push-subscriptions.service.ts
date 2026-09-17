import { Injectable } from '@nestjs/common';
import {
  PUSH_SUBSCRIPTIONS_MAX,
  type PushSubscriptionSummary,
  type PushSubscriptionsResponse,
  type RegisterPushSubscriptionRequest,
} from '@sunsteel/contracts';
import { DatabaseService } from '../../database/database.service';
import { PushConfigService } from './push-config.service';

const DEVICE_LABEL_MAX = 60;

@Injectable()
export class PushSubscriptionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: PushConfigService,
  ) {}

  /**
   * Registration is idempotent on the endpoint, because a browser hands back
   * the same one every time the app starts. Re-registering only refreshes the
   * keys and `lastSeenAt` — it never creates a second row for one device.
   */
  async register(
    userId: string,
    input: RegisterPushSubscriptionRequest,
  ): Promise<PushSubscriptionsResponse> {
    const deviceLabel = input.deviceLabel?.trim().slice(0, DEVICE_LABEL_MAX);
    const now = new Date();

    await this.db.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        expirationTime:
          input.expirationTime === null ? null : BigInt(input.expirationTime),
        deviceLabel: deviceLabel || null,
        lastSeenAt: now,
      },
      update: {
        // An endpoint can be reassigned to another account on a shared device,
        // so the owner is part of the update rather than assumed unchanged.
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        expirationTime:
          input.expirationTime === null ? null : BigInt(input.expirationTime),
        deviceLabel: deviceLabel || null,
        lastSeenAt: now,
      },
    });

    await this.evictBeyondCap(userId);
    return this.list(userId, input.endpoint);
  }

  /**
   * Keeps the newest `PUSH_SUBSCRIPTIONS_MAX` devices. Without a cap, a user
   * who clears site data repeatedly accumulates dead endpoints that every send
   * then has to try and fail.
   */
  private async evictBeyondCap(userId: string): Promise<void> {
    const subscriptions = await this.db.pushSubscription.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true },
      skip: PUSH_SUBSCRIPTIONS_MAX,
    });
    if (subscriptions.length === 0) return;
    await this.db.pushSubscription.deleteMany({
      where: { id: { in: subscriptions.map((row) => row.id) } },
    });
  }

  async list(
    userId: string,
    currentEndpoint?: string,
  ): Promise<PushSubscriptionsResponse> {
    const rows = await this.db.pushSubscription.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        endpoint: true,
        deviceLabel: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });

    const subscriptions: PushSubscriptionSummary[] = rows.map((row) => ({
      id: row.id,
      deviceLabel: row.deviceLabel,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      isCurrentDevice: row.endpoint === currentEndpoint,
    }));

    return { subscriptions, vapidPublicKey: this.config.publicKey };
  }

  /** Scoped to the owner, so one account cannot unsubscribe another's device. */
  async remove(
    userId: string,
    endpoint: string,
  ): Promise<PushSubscriptionsResponse> {
    await this.db.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return this.list(userId);
  }
}
