import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// `esModuleInterop` is off in this project while `allowSyntheticDefaultImports`
// is on, so `import webpush from 'web-push'` type-checks and then emits
// `webpush_1.default`, which is undefined at runtime. A namespace import is
// the form that actually compiles to `require('web-push')`.
import * as webpush from 'web-push';

/**
 * NOTIF-08: the VAPID key pair the server signs pushes with.
 *
 * Push is optional infrastructure. A deployment without the keys must keep
 * working exactly as before — every read reports push as unavailable and no
 * client is ever prompted for a permission that could not be honoured.
 */
@Injectable()
export class PushConfigService {
  private readonly logger = new Logger(PushConfigService.name);
  readonly publicKey: string | null;
  private readonly privateKey: string | null;

  constructor(config: ConfigService) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY')?.trim() || null;
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY')?.trim() || null;
    const subject =
      config.get<string>('VAPID_SUBJECT')?.trim() ||
      'mailto:support@sunnsteel.app';

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.publicKey = publicKey;
      this.privateKey = privateKey;
    } else {
      this.publicKey = null;
      this.privateKey = null;
      this.logger.warn(
        'VAPID keys are not configured; Web Push is disabled and clients will not be prompted.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.publicKey !== null && this.privateKey !== null;
  }
}
