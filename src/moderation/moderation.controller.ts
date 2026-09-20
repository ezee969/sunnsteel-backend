import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import {
  ModerationHistoryQueryDto,
  ModerationQueueQueryDto,
} from './dto/moderation-query.dto';
import { ReviewReportDto } from './dto/review-report.dto';
import { ModerationService } from './moderation.service';
import { ModeratorGuard } from './moderator.guard';

/**
 * TRUST-04. Every route is behind `ModeratorGuard`, which answers 404 rather
 * than 403 so the queue is indistinguishable from a route that was never
 * built.
 *
 * `POST .../views` looks like a write of nothing and is the opposite: it is
 * the record that a moderator opened somebody's reported content. It is a
 * POST because it writes, and it is separate from the queue read because
 * listing reports is not reading their subjects.
 */
@UseGuards(SupabaseJwtGuard, ModeratorGuard)
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('queue')
  queue(
    @Request() req: RequestWithUser,
    @Query() query: ModerationQueueQueryDto,
  ) {
    return this.moderation.queue(req.user.id, query);
  }

  @Get('actions')
  history(@Query() query: ModerationHistoryQueryDto) {
    return this.moderation.history(query);
  }

  @Post('reports/:id/views')
  view(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.moderation.recordView(req.user.id, id);
  }

  @Post('reports/:id/dismiss')
  dismiss(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewReportDto,
  ) {
    return this.moderation.dismiss(req.user.id, id, dto.note ?? null);
  }

  @Post('reports/:id/hide')
  hide(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewReportDto,
  ) {
    return this.moderation.hide(req.user.id, id, dto.note ?? null);
  }

  @Post('reports/:id/restore')
  restore(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewReportDto,
  ) {
    return this.moderation.restore(req.user.id, id, dto.note ?? null);
  }
}
