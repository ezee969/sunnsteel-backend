import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BillingController, BillingWebhooksController } from './billing.controller';
import { providerFromEnv } from './checkout-rules';
import { CheckoutService } from './checkout.service';
import { EntitlementsService } from './entitlements.service';
import { PAYMENT_PROVIDER } from './payment-provider';
import { ProviderNotificationsService } from './provider-notifications.service';
import { SubscriptionSyncService } from './subscription-sync.service';
import { EntitlementGuard } from './requires-entitlement';

/**
 * BILL-01: plans and entitlements. A module whose routes use
 * `@RequiresEntitlement()` imports this one for the guard and the service.
 * BILL-03: the payment provider the environment configures, or null, which
 * leaves checkout unavailable. BILL-04: the subscription lifecycle -- the
 * provider's notifications, the daily reconciliation and cancelling.
 */
@Module({
  providers: [
    EntitlementsService,
    EntitlementGuard,
    DatabaseService,
    CheckoutService,
    SubscriptionSyncService,
    ProviderNotificationsService,
    { provide: PAYMENT_PROVIDER, useFactory: () => providerFromEnv(process.env) },
  ],
  controllers: [BillingController, BillingWebhooksController],
  exports: [EntitlementsService, EntitlementGuard, SubscriptionSyncService],
})
export class BillingModule {}
