import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { BillingStatus, CheckoutConfirmation } from '@sunsteel/contracts';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { CheckoutService } from './checkout.service';
import { EntitlementsService } from './entitlements.service';

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
  ) {}

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
