import { IsISO8601, IsTimeZone } from 'class-validator';

export class WorkoutStatsQueryDto {
  @IsISO8601({ strict: true })
  weekStart!: string;

  @IsISO8601({ strict: true })
  weekEnd!: string;

  @IsTimeZone()
  timeZone!: string;
}

// Endpoint-local contract until the next published @sunsteel/contracts release.
export interface WorkoutStatsResponse {
  totalCompleted: number;
  completionRate: number;
  weeklyWorkoutsCount: number;
  activeDaysThisWeek: number;
}
