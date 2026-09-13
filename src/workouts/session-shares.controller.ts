import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { CreateSessionShareDto } from './dto/create-session-share.dto';
import { WorkoutSessionShareService } from './workout-session-share.service';

/** Owner-only management of a completed session's share links (SOC-07). */
@UseGuards(SupabaseJwtGuard)
@Controller('workouts/sessions/:id/shares')
export class SessionSharesController {
  constructor(private readonly shares: WorkoutSessionShareService) {}

  @Post()
  create(
    @Req() req: RequestWithUser,
    @Param('id') sessionId: string,
    @Body() dto: CreateSessionShareDto,
  ) {
    return this.shares.create(req.user.id, sessionId, dto.fields);
  }

  @Get()
  list(@Req() req: RequestWithUser, @Param('id') sessionId: string) {
    return this.shares.list(req.user.id, sessionId);
  }

  @Delete(':shareId')
  @HttpCode(204)
  revoke(
    @Req() req: RequestWithUser,
    @Param('id') sessionId: string,
    @Param('shareId') shareId: string,
  ) {
    return this.shares.revoke(req.user.id, sessionId, shareId);
  }
}

/**
 * Unguarded, like `/profiles/:identifier`: the unguessable token is the only
 * credential, and `no-store` keeps a revoked link from being served stale.
 */
@Controller('shared/sessions')
export class SharedSessionsController {
  constructor(private readonly shares: WorkoutSessionShareService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  getSharedSession(@Param('token') token: string) {
    return this.shares.getShared(token);
  }
}
