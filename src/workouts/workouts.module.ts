import { Module } from "@nestjs/common";
import { WorkoutsController } from "./workouts.controller";
import { DatabaseModule } from "../database/database.module";
import { WorkoutsService } from "./workouts.service";
import {
  WorkoutSessionCorrectionService,
  WorkoutSessionFinishService,
  WorkoutSessionLogService,
  WorkoutSessionRecapService,
  WorkoutSessionStartService,
  WorkoutSessionSubstitutionService,
} from "./services";
import { WorkoutSessionReadService } from "./workout-session-read.service";
import { WorkoutProgressService } from "./workout-progress.service";
import { WorkoutStrengthTrendService } from "./workout-strength-trend.service";
import { WorkoutExercisePerformanceService } from "./workout-exercise-performance.service";
import { WorkoutMuscleHeatmapService } from "./workout-muscle-heatmap.service";
import { WorkoutVolumeTrendService } from "./workout-volume-trend.service";
import { WorkoutSessionComparisonService } from "./workout-session-comparison.service";
import { WorkoutProgressTimelineService } from "./workout-progress-timeline.service";
import { WorkoutSessionShareService } from "./workout-session-share.service";
import {
  SessionSharesController,
  SharedSessionsController,
} from "./session-shares.controller";
import { GoalsModule } from "../goals/goals.module";
import { WorkoutPersonalGoalsService } from "./workout-personal-goals.service";
import { WorkoutPlateausService } from "./workout-plateaus.service";
import { PushModule } from "../notifications/push/push.module";

@Module({
  imports: [DatabaseModule, GoalsModule, PushModule],
  controllers: [
    WorkoutsController,
    SessionSharesController,
    SharedSessionsController,
  ],
  providers: [
    WorkoutsService,
    WorkoutSessionStartService,
    WorkoutSessionFinishService,
    WorkoutSessionCorrectionService,
    WorkoutSessionLogService,
    WorkoutSessionRecapService,
    WorkoutSessionSubstitutionService,
    WorkoutSessionReadService,
    WorkoutProgressService,
    WorkoutStrengthTrendService,
    WorkoutExercisePerformanceService,
    WorkoutMuscleHeatmapService,
    WorkoutVolumeTrendService,
    WorkoutSessionComparisonService,
    WorkoutProgressTimelineService,
    WorkoutSessionShareService,
    WorkoutPersonalGoalsService,
    WorkoutPlateausService,
  ],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
