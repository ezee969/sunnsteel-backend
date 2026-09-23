import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Query,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SupabaseJwtGuard } from "../auth/guards/supabase-jwt.guard";
import { WorkoutsService } from "./workouts.service";
import { StartWorkoutDto } from "./dto/start-workout.dto";
import { StartWorkoutResponseDto } from "./dto/start-workout-response.dto";
import { FinishWorkoutDto } from "./dto/finish-workout.dto";
import { UpsertSetLogDto } from "./dto/upsert-set-log.dto";
import { CorrectSessionDto } from "./dto/correct-session.dto";
import { UpdateSessionNotesDto } from "./dto/update-session-notes.dto";
import {
  WorkoutSessionCorrectionService,
  WorkoutSessionNotesService,
} from "./services";
import { SubstituteSessionExerciseDto } from "./dto/substitute-session-exercise.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { WorkoutStatsQueryDto } from "./dto/workout-stats.dto";
import { WorkoutProgressQueryDto } from "./dto/workout-progress.dto";
import { ExerciseStrengthTrendQueryDto } from "./dto/exercise-strength-trend.dto";
import { ExercisePerformanceHistoryQueryDto } from "./dto/exercise-performance-history.dto";
import { MuscleGroupHeatmapQueryDto } from "./dto/muscle-group-heatmap.dto";
import { VolumeTrendQueryDto } from "./dto/volume-trend.dto";
import { SessionComparisonQueryDto } from "./dto/session-comparison.dto";
import { ProgressTimelineQueryDto } from "./dto/progress-timeline.dto";
import type { RequestWithUser } from "../common/types/request-with-user";
import { RestAlertService } from "../notifications/push/rest-alert.service";
import { ScheduleRestAlertDto } from "../notifications/push/dto/schedule-rest-alert.dto";

@UseGuards(SupabaseJwtGuard)
@Controller("workouts")
export class WorkoutsController {
  constructor(
    private readonly workoutsService: WorkoutsService,
    private readonly restAlerts: RestAlertService,
    private readonly corrections: WorkoutSessionCorrectionService,
    private readonly notes: WorkoutSessionNotesService,
  ) {}

  @Post("sessions/start")
  async start(
    @Req() req: RequestWithUser,
    @Body() dto: StartWorkoutDto,
  ): Promise<StartWorkoutResponseDto> {
    return this.workoutsService.startSession(req.user.id, dto);
  }

  @Patch("sessions/:id/finish")
  async finish(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: FinishWorkoutDto,
  ) {
    return this.workoutsService.finishSession(req.user.id, id, dto);
  }

  @Get("sessions/active")
  async getActive(@Req() req: RequestWithUser) {
    return this.workoutsService.getActiveSession(req.user.id);
  }

  @Get("sessions")
  async list(@Req() req: RequestWithUser, @Query() query: ListSessionsDto) {
    return this.workoutsService.listSessions(req.user.id, query);
  }

  @Get("sessions/:id")
  async getById(@Req() req: RequestWithUser, @Param("id") id: string) {
    return this.workoutsService.getSessionById(req.user.id, id);
  }

  @Get("sessions/:id/previous-performance")
  async getPreviousPerformance(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    return this.workoutsService.getPreviousPerformance(req.user.id, id);
  }

  // LIVE-17: whether the workout can still be corrected, and every saved
  // correction with its before and after values.
  @Get("sessions/:id/corrections")
  async getCorrections(@Req() req: RequestWithUser, @Param("id") id: string) {
    return this.corrections.getCorrections(req.user.id, id);
  }

  @Post("sessions/:id/corrections")
  async correct(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: CorrectSessionDto,
  ) {
    return this.corrections.correctSession(req.user.id, id, dto);
  }

  // LIVE-16: the owner's notes about this workout, during it or after it.
  @Put("sessions/:id/notes")
  async updateNotes(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateSessionNotesDto,
  ) {
    return this.notes.updateNotes(req.user.id, id, dto);
  }

  @Get("sessions/:id/recap")
  async getRecap(@Req() req: RequestWithUser, @Param("id") id: string) {
    return this.workoutsService.getSessionRecap(req.user.id, id);
  }

  @Get("stats")
  async stats(
    @Req() req: RequestWithUser,
    @Query() query: WorkoutStatsQueryDto,
  ) {
    return this.workoutsService.getStats(req.user.id, query);
  }

  @Get("progress")
  async progress(
    @Req() req: RequestWithUser,
    @Query() query: WorkoutProgressQueryDto,
  ) {
    return this.workoutsService.getProgress(req.user.id, query);
  }

  @Get("progress/strength")
  async strengthTrend(
    @Req() req: RequestWithUser,
    @Query() query: ExerciseStrengthTrendQueryDto,
  ) {
    return this.workoutsService.getStrengthTrend(req.user.id, query);
  }

  @Get("progress/performance")
  async exercisePerformance(
    @Req() req: RequestWithUser,
    @Query() query: ExercisePerformanceHistoryQueryDto,
  ) {
    return this.workoutsService.getExercisePerformance(req.user.id, query);
  }

  @Get("progress/muscles")
  async muscleHeatmap(
    @Req() req: RequestWithUser,
    @Query() query: MuscleGroupHeatmapQueryDto,
  ) {
    return this.workoutsService.getMuscleHeatmap(req.user.id, query);
  }

  @Get("progress/volume")
  async volumeTrend(
    @Req() req: RequestWithUser,
    @Query() query: VolumeTrendQueryDto,
  ) {
    return this.workoutsService.getVolumeTrend(req.user.id, query);
  }

  @Get("progress/session-comparison")
  async sessionComparison(
    @Req() req: RequestWithUser,
    @Query() query: SessionComparisonQueryDto,
  ) {
    return this.workoutsService.getSessionComparison(req.user.id, query);
  }

  @Get("progress/timeline")
  async progressTimeline(
    @Req() req: RequestWithUser,
    @Query() query: ProgressTimelineQueryDto,
  ) {
    return this.workoutsService.getProgressTimeline(req.user.id, query);
  }

  @Get("progress/goals")
  async personalGoals(
    @Req() req: RequestWithUser,
    @Query() query: WorkoutProgressQueryDto,
  ) {
    return this.workoutsService.getPersonalGoals(req.user.id, query);
  }

  @Get("progress/plateaus")
  async plateaus(@Req() req: RequestWithUser) {
    return this.workoutsService.getPlateaus(req.user.id);
  }

  @Put("sessions/:id/set-logs")
  async upsertSetLog(
    @Req() req: RequestWithUser,
    @Param("id") sessionId: string,
    @Body() dto: UpsertSetLogDto,
  ) {
    return this.workoutsService.upsertSetLog(req.user.id, sessionId, dto);
  }

  @Delete("sessions/:id/set-logs/:routineExerciseId/:setNumber")
  async deleteSetLog(
    @Req() req: RequestWithUser,
    @Param("id") sessionId: string,
    @Param("routineExerciseId") routineExerciseId: string,
    @Param("setNumber", ParseIntPipe) setNumber: number,
  ) {
    return this.workoutsService.deleteSetLog(
      req.user.id,
      sessionId,
      routineExerciseId,
      setNumber,
    );
  }

  // LIVE-11: perform a different exercise for one slot of an active session.
  @Put("sessions/:id/exercises/:routineExerciseId/substitution")
  async substituteExercise(
    @Req() req: RequestWithUser,
    @Param("id") sessionId: string,
    @Param("routineExerciseId") routineExerciseId: string,
    @Body() dto: SubstituteSessionExerciseDto,
  ) {
    return this.workoutsService.substituteExercise(
      req.user.id,
      sessionId,
      routineExerciseId,
      dto,
    );
  }

  @Delete("sessions/:id/exercises/:routineExerciseId/substitution")
  async revertExerciseSubstitution(
    @Req() req: RequestWithUser,
    @Param("id") sessionId: string,
    @Param("routineExerciseId") routineExerciseId: string,
  ) {
    return this.workoutsService.revertExerciseSubstitution(
      req.user.id,
      sessionId,
      routineExerciseId,
    );
  }

  /**
   * NOTIF-03: schedule the push that fires when this session's rest period
   * ends. One pending alert per session — a new rest period replaces the last.
   * The response says plainly when nothing was scheduled, because the session
   * screen must not imply an alert the owner will never receive.
   */
  @Put("sessions/:id/rest-alert")
  async scheduleRestAlert(
    @Req() req: RequestWithUser,
    @Param("id") sessionId: string,
    @Body() dto: ScheduleRestAlertDto,
  ) {
    return this.restAlerts.schedule(req.user.id, sessionId, dto);
  }

  @Delete("sessions/:id/rest-alert")
  @HttpCode(204)
  async cancelRestAlert(
    @Req() req: RequestWithUser,
    @Param("id") sessionId: string,
  ) {
    await this.restAlerts.cancel(req.user.id, sessionId);
  }
}
