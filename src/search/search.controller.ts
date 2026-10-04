import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import {
  RecentSearchParamsDto,
  RecordRecentSearchDto,
  SearchPageQueryDto,
  SearchPreviewQueryDto,
} from './dto/search-query.dto';
import { RecentSearchesService } from './recent-searches.service';
import { SearchService } from './search.service';

/**
 * NAV-01: the header search's preview and one paged read per category.
 * NAV-03: the results the member last opened from it.
 */
@UseGuards(SupabaseJwtGuard)
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly recent: RecentSearchesService,
  ) {}

  @Get('recent')
  recentList(@Req() req: RequestWithUser) {
    return this.recent.list(req.user.id);
  }

  @Post('recent')
  recordRecent(@Req() req: RequestWithUser, @Body() body: RecordRecentSearchDto) {
    return this.recent.record(req.user.id, body.kind, body.targetId);
  }

  @Delete('recent')
  clearRecent(@Req() req: RequestWithUser) {
    return this.recent.clear(req.user.id);
  }

  @Delete('recent/:kind/:targetId')
  removeRecent(@Req() req: RequestWithUser, @Param() params: RecentSearchParamsDto) {
    return this.recent.remove(req.user.id, params.kind, params.targetId);
  }

  @Get()
  preview(@Req() req: RequestWithUser, @Query() query: SearchPreviewQueryDto) {
    return this.search.preview(req.user.id, query.q);
  }

  @Get('members')
  members(@Req() req: RequestWithUser, @Query() query: SearchPageQueryDto) {
    return this.search.members(req.user.id, query.q, query.cursor, query.limit);
  }

  @Get('routines')
  routines(@Req() req: RequestWithUser, @Query() query: SearchPageQueryDto) {
    return this.search.routines(req.user.id, query.q, query.cursor, query.limit);
  }

  @Get('workouts')
  workouts(@Req() req: RequestWithUser, @Query() query: SearchPageQueryDto) {
    return this.search.workouts(req.user.id, query.q, query.cursor, query.limit);
  }
}
