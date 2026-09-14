import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AchievementsResponse } from '@sunsteel/contracts';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { AchievementsService } from './achievements.service';

@UseGuards(SupabaseJwtGuard)
@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get()
  list(@Req() request: RequestWithUser): Promise<AchievementsResponse> {
    return this.achievements.list(request.user.id);
  }
}
