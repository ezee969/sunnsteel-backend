import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/passport-jwt.guard';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import { WorkoutsService } from './workouts.service';
import { UseInterceptors } from '@nestjs/common';
import { RtfEtagInterceptor } from '../common/interceptors/rtf-etag.interceptor';
import { StartWorkoutDto } from './dto/start-workout.dto';
import { StartWorkoutResponseDto } from './dto/start-workout-response.dto';
import { FinishWorkoutDto } from './dto/finish-workout.dto';
import { UpsertSetLogDto } from './dto/upsert-set-log.dto';
import { Request } from 'express';
import { ListSessionsDto } from './dto/list-sessions.dto';

// Reuse same request shape used across controllers
// user: { id: string; email: string }
type RequestWithUser = Request & { user: { id: string; email: string } };

@UseGuards(SupabaseJwtGuard)
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post('sessions/start')
  async start(
    @Req() req: RequestWithUser,
    @Body() dto: StartWorkoutDto,
  ): Promise<StartWorkoutResponseDto> {
    return this.workoutsService.startSession(req.user.id, dto);
  }

  @Patch('sessions/:id/finish')
  async finish(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: FinishWorkoutDto,
  ) {
    return this.workoutsService.finishSession(req.user.id, id, dto);
  }

  @Get('sessions/active')
  async getActive(@Req() req: RequestWithUser) {
    return this.workoutsService.getActiveSession(req.user.id);
  }

  @Get('sessions')
  async list(@Req() req: RequestWithUser, @Query() query: ListSessionsDto) {
    return this.workoutsService.listSessions(req.user.id, query);
  }

  @Get('sessions/:id')
  async getById(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.workoutsService.getSessionById(req.user.id, id);
  }

  @Put('sessions/:id/set-logs')
  async upsertSetLog(
    @Req() req: RequestWithUser,
    @Param('id') sessionId: string,
    @Body() dto: UpsertSetLogDto,
  ) {
    return this.workoutsService.upsertSetLog(req.user.id, sessionId, dto);
  }

  @Delete('sessions/:id/set-logs/:routineExerciseId/:setNumber')
  async deleteSetLog(
    @Req() req: RequestWithUser,
    @Param('id') sessionId: string,
    @Param('routineExerciseId') routineExerciseId: string,
    @Param('setNumber', ParseIntPipe) setNumber: number,
  ) {
    return this.workoutsService.deleteSetLog(
      req.user.id,
      sessionId,
      routineExerciseId,
      setNumber,
    );
  }

  // RtF week goals inspection endpoint
  @Get('routines/:routineId/rtf-week-goals')
  @UseInterceptors(RtfEtagInterceptor)
  async getRtFWeekGoals(
    @Req() req: RequestWithUser,
    @Param('routineId') routineId: string,
    @Query('week') week?: string,
  ) {
    const weekNum = week ? parseInt(week, 10) : undefined;
    return this.workoutsService.getRtFWeekGoals(
      req.user.id,
      routineId,
      weekNum,
    );
  }

  // RtF full timeline (all program weeks) endpoint (RTF-B03)
  @Get('routines/:routineId/rtf-timeline')
  @UseInterceptors(RtfEtagInterceptor)
  async getRtFTimeline(
    @Req() req: RequestWithUser,
    @Param('routineId') routineId: string,
  ) {
    return this.workoutsService.getRtFTimeline(req.user.id, routineId);
  }

  // RtF forecast (projected future intensities/reps) (RTF-B06)
  @Get('routines/:routineId/rtf-forecast')
  @UseInterceptors(RtfEtagInterceptor)
  async getRtFForecast(
    @Req() req: RequestWithUser,
    @Param('routineId') routineId: string,
  ) {
    return this.workoutsService.getRtFForecast(req.user.id, routineId);
  }
}
