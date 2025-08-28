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
import { WorkoutsService } from './workouts.service';
import { StartWorkoutDto } from './dto/start-workout.dto';
import { FinishWorkoutDto } from './dto/finish-workout.dto';
import { UpsertSetLogDto } from './dto/upsert-set-log.dto';
import { Request } from 'express';
import { ListSessionsDto } from './dto/list-sessions.dto';

// Reuse same request shape used across controllers
// user: { userId: string; email: string }
type RequestWithUser = Request & { user: { userId: string; email: string } };

@UseGuards(JwtAuthGuard)
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post('sessions/start')
  async start(@Req() req: RequestWithUser, @Body() dto: StartWorkoutDto) {
    return this.workoutsService.startSession(req.user.userId, dto);
  }

  @Patch('sessions/:id/finish')
  async finish(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: FinishWorkoutDto,
  ) {
    return this.workoutsService.finishSession(req.user.userId, id, dto);
  }

  @Get('sessions/active')
  async getActive(@Req() req: RequestWithUser) {
    return this.workoutsService.getActiveSession(req.user.userId);
  }

  @Get('sessions')
  async list(@Req() req: RequestWithUser, @Query() query: ListSessionsDto) {
    return this.workoutsService.listSessions(req.user.userId, query);
  }

  @Get('sessions/:id')
  async getById(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.workoutsService.getSessionById(req.user.userId, id);
  }

  @Put('sessions/:id/set-logs')
  async upsertSetLog(
    @Req() req: RequestWithUser,
    @Param('id') sessionId: string,
    @Body() dto: UpsertSetLogDto,
  ) {
    return this.workoutsService.upsertSetLog(req.user.userId, sessionId, dto);
  }

  @Delete('sessions/:id/set-logs/:routineExerciseId/:setNumber')
  async deleteSetLog(
    @Req() req: RequestWithUser,
    @Param('id') sessionId: string,
    @Param('routineExerciseId') routineExerciseId: string,
    @Param('setNumber', ParseIntPipe) setNumber: number,
  ) {
    return this.workoutsService.deleteSetLog(
      req.user.userId,
      sessionId,
      routineExerciseId,
      setNumber,
    );
  }
}
