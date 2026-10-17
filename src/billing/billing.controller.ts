import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import type { BillingStatus } from '@sunsteel/contracts';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { EntitlementsService } from './entitlements.service';

/** BILL-01: the caller's plan, what it unlocks and the grants behind it. */
@UseGuards(SupabaseJwtGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get('me')
  me(@Request() req: RequestWithUser): Promise<BillingStatus> {
    return this.entitlements.status(req.user.id);
  }
}
