import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { apiError, type BillingStatus, type CheckoutConfirmation } from '@sunsteel/contracts';
import type { Response } from 'express';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { ModeratorGuard } from '../moderation/moderator.guard';
import { argentinaMonthRange, chargesCsv, previousArgentinaMonth } from './charges-report';
import { CheckoutService } from './checkout.service';
import { EntitlementsService } from './entitlements.service';
import {
  describeProviderError,
  PAYMENT_PROVIDER,
  PaymentProviderError,
  type PaymentProvider,
} from './payment-provider';
import { ProviderNotificationsService } from './provider-notifications.service';
import { SubscriptionSyncService } from './subscription-sync.service';

/**
 * BILL-01: the caller's plan, what it unlocks and the grants behind it.
 * BILL-03: buying Pro through the payment provider's page.
 */
@UseGuards(SupabaseJwtGuard)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly checkout: CheckoutService,
    private readonly subscriptions: SubscriptionSyncService,
  ) {}

  /**
   * BILL-04: cancels the member's subscription at the provider. Nothing
   * renews; Pro lasts to the end of what was paid.
   */
  @Post('subscription/cancel')
  @HttpCode(200)
  @Throttle({ long: { limit: 10, ttl: 600_000 } })
  async cancelSubscription(@Request() req: RequestWithUser): Promise<BillingStatus> {
    await this.subscriptions.cancel(req.user.id);
    return this.entitlements.status(req.user.id);
  }

  @Get('me')
  me(@Request() req: RequestWithUser): Promise<BillingStatus> {
    return this.entitlements.status(req.user.id);
  }

  /** Opens the member's one waiting attempt, or returns it. */
  @Post('checkout')
  @Throttle({ long: { limit: 10, ttl: 600_000 } })
  async startCheckout(@Request() req: RequestWithUser): Promise<CheckoutConfirmation> {
    const attempt = await this.checkout.start(req.user);
    return { attempt, billing: await this.entitlements.status(req.user.id) };
  }

  /** Reads the provider for an attempt; only an authorized subscription grants Pro. */
  @Post('checkout/:id/confirm')
  @HttpCode(200)
  @Throttle({ long: { limit: 30, ttl: 600_000 } })
  async confirmCheckout(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CheckoutConfirmation> {
    const attempt = await this.checkout.confirm(req.user.id, id);
    return { attempt, billing: await this.entitlements.status(req.user.id) };
  }
}

/**
 * BILL-04: the provider's notifications. Unguarded -- the provider has no
 * member's token -- so the signature is the only authentication, checked by
 * the provider's adapter before anything is stored.
 */
@Controller('billing/webhooks')
export class BillingWebhooksController {
  constructor(private readonly notifications: ProviderNotificationsService) {}

  @Post(':provider')
  @HttpCode(200)
  receive(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    return this.notifications.receive(provider, { headers, query, body });
  }
}

/**
 * BILL-06: the month's charges as a CSV, for the owner to issue a Factura C
 * for each in ARCA. Read from the provider every time, so it lists what was
 * charged rather than what this server believes; moderators only, and like
 * every moderation route a non-moderator meets a 404.
 */
@UseGuards(SupabaseJwtGuard, ModeratorGuard)
@Controller('moderation/billing')
export class BillingChargesController {
  private readonly logger = new Logger(BillingChargesController.name);

  constructor(
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null = null,
  ) {}

  /** `?month=YYYY-MM`, Argentina's month; the previous month when omitted. */
  @Get('charges')
  @Throttle({ long: { limit: 20, ttl: 600_000 } })
  async charges(
    @Query('month') month: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const chosen = month ?? previousArgentinaMonth(new Date());
    const range = argentinaMonthRange(chosen);
    if (!range) throw new BadRequestException('month must be YYYY-MM');
    if (!this.provider) throw new ServiceUnavailableException(apiError('CHECKOUT_UNAVAILABLE'));
    let csv: string;
    try {
      csv = chargesCsv(await this.provider.listCharges(range.from, range.to));
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        this.logger.warn(`Listing charges failed: ${describeProviderError(error)}`);
        throw new BadGatewayException(apiError('CHECKOUT_PROVIDER_ERROR'));
      }
      throw error;
    }
    const mode = this.provider.testMode ? '-sandbox' : '';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cobros-${chosen}${mode}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return csv;
  }
}
