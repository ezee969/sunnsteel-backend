import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BillingController } from './billing.controller';
import { EntitlementsService } from './entitlements.service';
import { EntitlementGuard } from './requires-entitlement';

/**
 * BILL-01: plans and entitlements. A module whose routes use
 * `@RequiresEntitlement()` imports this one for the guard and the service.
 */
@Module({
  providers: [EntitlementsService, EntitlementGuard, DatabaseService],
  controllers: [BillingController],
  exports: [EntitlementsService, EntitlementGuard],
})
export class BillingModule {}
