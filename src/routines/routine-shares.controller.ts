import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { UpdateRoutineVisibilityDto } from './dto/update-routine-visibility.dto';
import { RoutineSharingService } from './routine-sharing.service';

/** ROUT-04: the owner's controls for one routine. */
@UseGuards(SupabaseJwtGuard)
@Controller('routines/:id')
export class RoutineSharesController {
  constructor(private readonly sharing: RoutineSharingService) {}

  @Put('visibility')
  @HttpCode(200)
  setVisibility(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Body() dto: UpdateRoutineVisibilityDto,
  ) {
    return this.sharing.setVisibility(req.user.id, routineId, dto.visibility);
  }

  @Get('shares')
  list(@Req() req: RequestWithUser, @Param('id') routineId: string) {
    return this.sharing.listShares(req.user.id, routineId);
  }

  @Post('shares')
  create(@Req() req: RequestWithUser, @Param('id') routineId: string) {
    return this.sharing.createShare(req.user.id, routineId);
  }

  @Delete('shares/:shareId')
  @HttpCode(200)
  revoke(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Param('shareId') shareId: string,
  ) {
    return this.sharing.revokeShare(req.user.id, routineId, shareId);
  }
}

/**
 * The unauthenticated read. `no-store` for the same reason the public profile
 * uses it: revoking a link, or narrowing a routine, must take effect at once
 * rather than leaving a cached copy readable.
 */
@Controller('shared/routines')
export class SharedRoutinesController {
  constructor(private readonly sharing: RoutineSharingService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  read(@Param('token') token: string) {
    return this.sharing.readByToken(token);
  }
}
