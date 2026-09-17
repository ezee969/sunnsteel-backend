import { Injectable, Logger } from '@nestjs/common';
import type { PushPayload } from '@sunsteel/contracts';
// `esModuleInterop` is off in this project while `allowSyntheticDefaultImports`
// is on, so `import webpush from 'web-push'` type-checks and then emits
// `webpush_1.default`, which is undefined at runtime. A namespace import is
// the form that actually compiles to `require('web-push')`.
import * as webpush from 'web-push';
import { DatabaseService } from '../../database/database.service';
import { PushConfigService } from './push-config.service';

/**
 * A push endpoint that answers 404 or 410 is permanently gone: the browser
 * dropped the subscription or the user uninstalled the app. Anything else
 * (429, 5xx, a network error) may succeed next time and must not delete it.
 */
const GONE_STATUS_CODES = new Set([404, 410]);

interface SendResult {
  /** Endpoints that accepted the payload. */
  sent: number;
  /** Subscriptions deleted because the endpoint is permanently gone. */
  retired: number;
}

@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: PushConfigService,
  ) {}

  /**
   * Deliver one payload to every device the account has subscribed. A failure
   * on one endpoint never stops the others: a user with a stale desktop
   * subscription must still get the alert on the phone in their pocket.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<SendResult> {
    if (!this.config.isConfigured) return { sent: 0, retired: 0 };

    const subscriptions = await this.db.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subscriptions.length === 0) return { sent: 0, retired: 0 };

    const body = JSON.stringify(payload);
    const gone: string[] = [];
    let sent = 0;

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await this.deliver(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            body,
          );
          sent += 1;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode && GONE_STATUS_CODES.has(statusCode)) {
            gone.push(subscription.id);
            return;
          }
          this.logger.warn(
            `Push to one endpoint failed (status ${statusCode ?? 'none'}); keeping the subscription.`,
          );
        }
      }),
    );

    if (gone.length > 0) {
      await this.db.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    }
    return { sent, retired: gone.length };
  }

  /**
   * The single call into `web-push`. It is a seam on purpose: the retire rules
   * above are the part worth testing, and a test should not have to stand up a
   * real push endpoint or monkey-patch a third-party module to reach them.
   */
  protected deliver(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    body: string,
  ): Promise<unknown> {
    return webpush.sendNotification(subscription, body);
  }
}
