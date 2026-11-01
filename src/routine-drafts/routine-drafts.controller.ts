import { Body, Controller, Get, HttpCode, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RoutineDraftResult, RoutineDraftUsage } from '@sunsteel/contracts';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import { RequiresEntitlement } from '../billing/requires-entitlement';
import type { RequestWithUser } from '../common/types/request-with-user';
import { CreateRoutineDraftDto } from './dto/create-routine-draft.dto';
import { RoutineDraftsService } from './routine-drafts.service';

/**
 * INTEL-03: a Pro member's monthly drafts and the writing of one. The
 * entitlement goes on each route, because method guards follow class guards:
 * on the class it would run before the sign-in and find no member.
 */
@UseGuards(SupabaseJwtGuard)
@Controller('routine-drafts')
export class RoutineDraftsController {
  constructor(private readonly drafts: RoutineDraftsService) {}

  @Get('usage')
  @RequiresEntitlement('ROUTINE_DRAFTS')
  usage(@Request() req: RequestWithUser): Promise<RoutineDraftUsage> {
    return this.drafts.usageOf(req.user.id);
  }

  /** Creates nothing: the answer is a draft for the wizard, stored only on Create. */
  @Post()
  @HttpCode(200)
  @RequiresEntitlement('ROUTINE_DRAFTS')
  @Throttle({ long: { limit: 6, ttl: 60_000 } })
  create(
    @Request() req: RequestWithUser,
    @Body() body: CreateRoutineDraftDto,
  ): Promise<RoutineDraftResult> {
    return this.drafts.create(req.user.id, body);
  }
}
