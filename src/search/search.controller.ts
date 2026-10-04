import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { SearchPageQueryDto, SearchPreviewQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

/** NAV-01: the header search's preview and one paged read per category. */
@UseGuards(SupabaseJwtGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

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
