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
import { CreateDeloadDto } from './dto/create-deload.dto';
import { RoutineDeloadsService } from './routine-deloads.service';

/** ROUT-16: plan, end early and cancel a routine's temporary deloads. */
@UseGuards(SupabaseJwtGuard)
@Controller('routines/:id/deloads')
export class RoutineDeloadsController {
  constructor(private readonly deloads: RoutineDeloadsService) {}

  @Get()
  list(@Req() req: RequestWithUser, @Param('id') routineId: string) {
    return this.deloads.list(req.user.id, routineId);
  }

  @Post()
  create(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Body() dto: CreateDeloadDto,
  ) {
    return this.deloads.create(req.user.id, routineId, dto);
  }

  @Post(':overrideId/end')
  endEarly(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Param('overrideId') overrideId: string,
  ) {
    return this.deloads.endEarly(req.user.id, routineId, overrideId);
  }

  @Delete(':overrideId')
  @HttpCode(204)
  async cancel(
    @Req() req: RequestWithUser,
    @Param('id') routineId: string,
    @Param('overrideId') overrideId: string,
  ) {
    await this.deloads.cancel(req.user.id, routineId, overrideId);
  }
}
