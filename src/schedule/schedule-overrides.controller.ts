import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import {
  MoveOccurrenceDto,
  ScheduleOverridesQueryDto,
} from './dto/move-occurrence.dto';
import { ScheduleOverridesService } from './schedule-overrides.service';

/** SCHED-04: read, move and undo per-date overrides of the owner's plan. */
@UseGuards(SupabaseJwtGuard)
@Controller('schedule/overrides')
export class ScheduleOverridesController {
  constructor(private readonly overrides: ScheduleOverridesService) {}

  @Get()
  list(@Req() req: RequestWithUser, @Query() query: ScheduleOverridesQueryDto) {
    return this.overrides.list(req.user.id, query.from, query.to);
  }

  @Put('move')
  move(@Req() req: RequestWithUser, @Body() dto: MoveOccurrenceDto) {
    return this.overrides.move(req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.overrides.remove(req.user.id, id);
  }
}
