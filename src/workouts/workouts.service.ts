import { Injectable } from "@nestjs/common";
import { WorkoutStatsQueryDto } from "./dto/workout-stats.dto";
import type {
  FinishWorkoutResponse,
  ListSessionsParams,
  PreviousPerformanceResponse,
  UpsertSetLogResponse,
  WorkoutSession,
  WorkoutSessionListResponse,
} from "@sunsteel/contracts";
import { StartWorkoutDto } from "./dto/start-workout.dto";
import { StartWorkoutResponseDto } from "./dto/start-workout-response.dto";
import { FinishWorkoutDto } from "./dto/finish-workout.dto";
import { UpsertSetLogDto } from "./dto/upsert-set-log.dto";
import {
  WorkoutSessionFinishService,
  WorkoutSessionLogService,
  WorkoutSessionRecapService,
  WorkoutSessionStartService,
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

  async listSessions(
    userId: string,
    params: ListSessionsParams,
  ): Promise<WorkoutSessionListResponse> {
    return this.workoutSessionRead.listSessions(userId, params);
  }
}
