import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { ActivityService } from './activity.service';
import {
  ActivityCommentsQueryDto,
  ActivityPageQueryDto,
  ActivityPreviewQueryDto,
  CreateActivityCommentDto,
  SetActivityEntryAudienceDto,
  SetActivityReactionDto,
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

  /** SOC-05: acknowledging one entry, refused when the viewer may not see it. */
  @Put('entries/reaction')
  setReaction(
    @Request() req: RequestWithUser,
    @Body() dto: SetActivityReactionDto,
  ) {
    return this.activity.setReaction(req.user.id, dto);
  }

  @Put('entries/audience')
  setEntryAudience(
    @Request() req: RequestWithUser,
    @Body() dto: SetActivityEntryAudienceDto,
  ) {
    return this.activity.setEntryAudience(req.user.id, dto);
  }

  /**
   * SOC-06. All three go through the same entry resolution a reaction does, so
   * an entry the viewer may not see answers 404 from every one of them.
   */
  @Get('entries/comments')
  listComments(
    @Request() req: RequestWithUser,
    @Query() query: ActivityCommentsQueryDto,
  ) {
    return this.activity.listComments(req.user.id, query);
  }

  @Post('entries/comments')
  createComment(
    @Request() req: RequestWithUser,
    @Body() dto: CreateActivityCommentDto,
  ) {
    return this.activity.createComment(req.user.id, dto);
  }

  @Delete('entries/comments/:id')
  deleteComment(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.activity.deleteComment(req.user.id, id);
  }
}
