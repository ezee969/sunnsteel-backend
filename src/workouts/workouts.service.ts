import { Injectable } from "@nestjs/common";
import { WorkoutStatsQueryDto } from "./dto/workout-stats.dto";
import type {
  FinishWorkoutResponse,
  ListSessionsParams,
  PreviousPerformanceResponse,
  SubstituteSessionExerciseResponse,
  UpsertSetLogResponse,
  WorkoutSession,
  WorkoutSessionListResponse,
} from "@sunsteel/contracts";
import { StartWorkoutDto } from "./dto/start-workout.dto";
import { StartWorkoutResponseDto } from "./dto/start-workout-response.dto";
import { FinishWorkoutDto } from "./dto/finish-workout.dto";
import { UpsertSetLogDto } from "./dto/upsert-set-log.dto";
import { SubstituteSessionExerciseDto } from "./dto/substitute-session-exercise.dto";
import {
  WorkoutSessionFinishService,
  WorkoutSessionLogService,
  WorkoutSessionRecapService,
  WorkoutSessionStartService,
  WorkoutSessionSubstitutionService,
} from "./services";
import { WorkoutSessionReadService } from "./workout-session-read.service";
import { WorkoutProgressService } from "./workout-progress.service";
import { WorkoutProgressQueryDto } from "./dto/workout-progress.dto";
import { ExerciseStrengthTrendQueryDto } from "./dto/exercise-strength-trend.dto";
import { toWorkoutSessionResponse } from "./workout-session.mapper";
import { WorkoutStrengthTrendService } from "./workout-strength-trend.service";
import { WorkoutExercisePerformanceService } from "./workout-exercise-performance.service";
import { ExercisePerformanceHistoryQueryDto } from "./dto/exercise-performance-history.dto";
import { MuscleGroupHeatmapQueryDto } from "./dto/muscle-group-heatmap.dto";
import { WorkoutMuscleHeatmapService } from "./workout-muscle-heatmap.service";
import { VolumeTrendQueryDto } from "./dto/volume-trend.dto";
import { WorkoutVolumeTrendService } from "./workout-volume-trend.service";
import { WorkoutSessionComparisonService } from "./workout-session-comparison.service";
import { SessionComparisonQueryDto } from "./dto/session-comparison.dto";
import { WorkoutProgressTimelineService } from "./workout-progress-timeline.service";
import { ProgressTimelineQueryDto } from "./dto/progress-timeline.dto";
import { WorkoutPersonalGoalsService } from "./workout-personal-goals.service";
import { WorkoutPlateausService } from "./workout-plateaus.service";
import { WorkoutTrainingSignalsService } from "./workout-training-signals.service";
import { WorkoutDeloadSuggestionService } from "./workout-deload-suggestion.service";

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly workoutSessionRead: WorkoutSessionReadService,
    private readonly workoutSessionStart: WorkoutSessionStartService,
    private readonly workoutSessionFinish: WorkoutSessionFinishService,
    private readonly workoutSessionLog: WorkoutSessionLogService,
    private readonly workoutSessionRecap: WorkoutSessionRecapService,
    private readonly workoutProgress: WorkoutProgressService,
    private readonly workoutStrengthTrend: WorkoutStrengthTrendService,
    private readonly workoutExercisePerformance: WorkoutExercisePerformanceService,
    private readonly workoutMuscleHeatmap: WorkoutMuscleHeatmapService,
    private readonly workoutVolumeTrend: WorkoutVolumeTrendService,
    private readonly workoutSessionComparison: WorkoutSessionComparisonService,
    private readonly workoutProgressTimeline: WorkoutProgressTimelineService,
    private readonly workoutPersonalGoals: WorkoutPersonalGoalsService,
    private readonly workoutPlateaus: WorkoutPlateausService,
    private readonly workoutTrainingSignals: WorkoutTrainingSignalsService,
    private readonly workoutDeloadSuggestion: WorkoutDeloadSuggestionService,
    private readonly workoutSessionSubstitution: WorkoutSessionSubstitutionService,
  ) {}

  async getActiveSession(userId: string): Promise<WorkoutSession | null> {
    const session = await this.workoutSessionRead.getActiveSession(userId);
    return session ? toWorkoutSessionResponse(session) : null;
  }

  getStats(userId: string, query: WorkoutStatsQueryDto) {
    return this.workoutSessionRead.getStats(userId, query);
  }

  getProgress(userId: string, query: WorkoutProgressQueryDto) {
    return this.workoutProgress.getProgress(userId, query);
  }

  getStrengthTrend(userId: string, query: ExerciseStrengthTrendQueryDto) {
    return this.workoutStrengthTrend.getStrengthTrend(userId, query);
  }

  getExercisePerformance(
    userId: string,
    query: ExercisePerformanceHistoryQueryDto,
  ) {
    return this.workoutExercisePerformance.getExercisePerformance(
      userId,
      query,
    );
  }

  getMuscleHeatmap(userId: string, query: MuscleGroupHeatmapQueryDto) {
    return this.workoutMuscleHeatmap.getMuscleHeatmap(userId, query);
  }

  getVolumeTrend(userId: string, query: VolumeTrendQueryDto) {
    return this.workoutVolumeTrend.getVolumeTrend(userId, query);
  }

  getSessionComparison(userId: string, query: SessionComparisonQueryDto) {
    return this.workoutSessionComparison.getSessionComparison(userId, query);
  }

  getProgressTimeline(userId: string, query: ProgressTimelineQueryDto) {
    return this.workoutProgressTimeline.getProgressTimeline(userId, query);
  }

  getPersonalGoals(userId: string, query: WorkoutProgressQueryDto) {
    return this.workoutPersonalGoals.getPersonalGoals(userId, query);
  }

  getPlateaus(userId: string) {
    return this.workoutPlateaus.getPlateaus(userId);
  }

  getTrainingSignals(userId: string) {
    return this.workoutTrainingSignals.getTrainingSignals(userId);
  }

  getDeloadSuggestion(userId: string) {
    return this.workoutDeloadSuggestion.getDeloadSuggestion(userId);
  }

  async getSessionById(userId: string, id: string): Promise<WorkoutSession> {
    const session = await this.workoutSessionRead.getSessionById(userId, id);
    return toWorkoutSessionResponse(session);
  }

  getPreviousPerformance(
    userId: string,
    id: string,
  ): Promise<PreviousPerformanceResponse | null> {
    return this.workoutSessionRead.getPreviousPerformance(userId, id);
  }

  async startSession(
    userId: string,
    dto: StartWorkoutDto,
  ): Promise<StartWorkoutResponseDto> {
    return this.workoutSessionStart.startSession(userId, dto);
  }

  async finishSession(
    userId: string,
    id: string,
    dto: FinishWorkoutDto,
  ): Promise<FinishWorkoutResponse> {
    const result = await this.workoutSessionFinish.finishSession(
      userId,
      id,
      dto,
    );
    return {
      session: toWorkoutSessionResponse(result.session),
      progressionChanges: result.progressionChanges,
      recap:
        dto.status === "COMPLETED"
          ? await this.workoutSessionRecap.getSessionRecap(userId, id)
          : null,
    };
  }

  getSessionRecap(userId: string, id: string) {
    return this.workoutSessionRecap.getSessionRecap(userId, id);
  }

  async upsertSetLog(
    userId: string,
    sessionId: string,
    dto: UpsertSetLogDto,
  ): Promise<UpsertSetLogResponse> {
    return this.workoutSessionLog.upsertSetLog(userId, sessionId, dto);
  }

  async deleteSetLog(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
    setNumber: number,
  ) {
    return this.workoutSessionLog.deleteSetLog(
      userId,
      sessionId,
      routineExerciseId,
      setNumber,
    );
  }

  substituteExercise(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
    dto: SubstituteSessionExerciseDto,
  ): Promise<SubstituteSessionExerciseResponse> {
    return this.workoutSessionSubstitution.substitute(
      userId,
      sessionId,
      routineExerciseId,
      dto,
    );
  }

  revertExerciseSubstitution(
    userId: string,
    sessionId: string,
    routineExerciseId: string,
  ): Promise<SubstituteSessionExerciseResponse> {
    return this.workoutSessionSubstitution.revert(
      userId,
      sessionId,
      routineExerciseId,
    );
  }

  async listSessions(
    userId: string,
    params: ListSessionsParams,
  ): Promise<WorkoutSessionListResponse> {
    return this.workoutSessionRead.listSessions(userId, params);
  }
}
