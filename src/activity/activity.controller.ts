import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { ActivityService } from './activity.service';
import {
  ActivityPageQueryDto,
  ActivityPreviewQueryDto,
  SetActivityEntryAudienceDto,
  UpdateActivitySharingDto,
} from './dto/activity.dto';

/**
 * SOC-03/SOC-04. Signed-in only: activity is never shown to a signed-out
 * visitor, so "Everyone" means every member of Sunnsteel.
 */
@UseGuards(SupabaseJwtGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('feed')
  feed(@Request() req: RequestWithUser, @Query() query: ActivityPageQueryDto) {
    return this.activity.feed(req.user.id, query);
  }

  @Get('mine')
  mine(@Request() req: RequestWithUser, @Query() query: ActivityPageQueryDto) {
    return this.activity.mine(req.user.id, query);
  }

  @Get('mine/preview')
  preview(
    @Request() req: RequestWithUser,
    @Query() query: ActivityPreviewQueryDto,
  ) {
    return this.activity.preview(req.user.id, query);
  }

  @Get('members/:identifier')
  member(
    @Request() req: RequestWithUser,
    @Param('identifier') identifier: string,
    @Query() query: ActivityPageQueryDto,
  ) {
    return this.activity.member(req.user.id, identifier, query);
  }

  @Get('sharing')
  sharing(@Request() req: RequestWithUser) {
    return this.activity.sharing(req.user.id);
  }

  @Put('sharing')
  updateSharing(
    @Request() req: RequestWithUser,
    @Body() dto: UpdateActivitySharingDto,
  ) {
    return this.activity.updateSharing(req.user.id, dto);
  }

  @Put('entries/audience')
  setEntryAudience(
    @Request() req: RequestWithUser,
    @Body() dto: SetActivityEntryAudienceDto,
  ) {
    return this.activity.setEntryAudience(req.user.id, dto);
  }
}
