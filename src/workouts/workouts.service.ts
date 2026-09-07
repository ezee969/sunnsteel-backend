import { Injectable } from '@nestjs/common';
import { WorkoutStatsQueryDto } from './dto/workout-stats.dto';
import {
  ListSessionsParams,
  PreviousPerformanceResponse,
  WorkoutSession,
  WorkoutSessionListResponse,
} from '@sunsteel/contracts';
import { StartWorkoutDto } from './dto/start-workout.dto';
import { StartWorkoutResponseDto } from './dto/start-workout-response.dto';
import { FinishWorkoutDto } from './dto/finish-workout.dto';
import { UpsertSetLogDto } from './dto/upsert-set-log.dto';
import {
  WorkoutSessionFinishService,
  WorkoutSessionLogService,
  WorkoutSessionStartService,
} from './services';
import { WorkoutSessionReadService } from './workout-session-read.service';
import { WorkoutProgressService } from './workout-progress.service';
import { WorkoutProgressQueryDto } from './dto/workout-progress.dto';
import { toWorkoutSessionResponse } from './workout-session.mapper';

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly workoutSessionRead: WorkoutSessionReadService,
    private readonly workoutSessionStart: WorkoutSessionStartService,
    private readonly workoutSessionFinish: WorkoutSessionFinishService,
    private readonly workoutSessionLog: WorkoutSessionLogService,
    private readonly workoutProgress: WorkoutProgressService,
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
  ): Promise<WorkoutSession> {
    const session = await this.workoutSessionFinish.finishSession(
      userId,
      id,
      dto,
    );
    return toWorkoutSessionResponse(session);
  }

  async upsertSetLog(userId: string, sessionId: string, dto: UpsertSetLogDto) {
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
