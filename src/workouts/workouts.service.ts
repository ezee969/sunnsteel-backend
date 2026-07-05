import { Injectable } from '@nestjs/common';
import {
  ListSessionsParams,
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
import { toWorkoutSessionResponse } from './workout-session.mapper';

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly workoutSessionRead: WorkoutSessionReadService,
    private readonly workoutSessionStart: WorkoutSessionStartService,
    private readonly workoutSessionFinish: WorkoutSessionFinishService,
    private readonly workoutSessionLog: WorkoutSessionLogService,
  ) {}

  async getActiveSession(userId: string): Promise<WorkoutSession | null> {
    const session = await this.workoutSessionRead.getActiveSession(userId);
    return session ? toWorkoutSessionResponse(session) : null;
  }

  async getSessionById(userId: string, id: string): Promise<WorkoutSession> {
    const session = await this.workoutSessionRead.getSessionById(userId, id);
    return toWorkoutSessionResponse(session);
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
