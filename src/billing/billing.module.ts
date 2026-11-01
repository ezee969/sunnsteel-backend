import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BillingController } from './billing.controller';
import { providerFromEnv } from './checkout-rules';
import { CheckoutService } from './checkout.service';
import { EntitlementsService } from './entitlements.service';
import { PAYMENT_PROVIDER } from './payment-provider';
import { EntitlementGuard } from './requires-entitlement';

/**
 * BILL-01: plans and entitlements. A module whose routes use
 * `@RequiresEntitlement()` imports this one for the guard and the service.
 * BILL-03: the payment provider the environment configures, or null, which
 * leaves checkout unavailable.
 */
@Module({
  providers: [
    EntitlementsService,
    EntitlementGuard,
    DatabaseService,
    CheckoutService,
    { provide: PAYMENT_PROVIDER, useFactory: () => providerFromEnv(process.env) },
  ],
  controllers: [BillingController],
  exports: [EntitlementsService, EntitlementGuard],
})
export class BillingModule {}
