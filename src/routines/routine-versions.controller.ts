import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import type { RequestWithUser } from '../common/types/request-with-user';
import { CreateRoutineVersionDto } from './dto/create-routine-version.dto';
import { RoutineVersionsService } from './routine-versions.service';

/** ROUT-08: save, list, restore and delete versions of one routine. */
@UseGuards(SupabaseJwtGuard)
@Controller('routines/:id/versions')
export class RoutineVersionsController {
  constructor(private readonly versions: RoutineVersionsService) {}

  @Get()
  list(@Req() req: RequestWithUser, @Param('id') routineId: string) {
    return this.versions.list(req.user.id, routineId);
  }

  @Post()
  create(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Body() dto: CreateRoutineVersionDto,
  ) {
    return this.versions.create(req.user.id, routineId, dto.name);
  }

  @Post(':versionId/restore')
  @HttpCode(200)
  restore(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versions.restore(req.user.id, routineId, versionId);
  }

  @Delete(':versionId')
  @HttpCode(204)
  async remove(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Param('versionId') versionId: string,
  ) {
    await this.versions.remove(req.user.id, routineId, versionId);
  }
}
