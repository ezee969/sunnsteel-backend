import { IsISO8601, IsTimeZone } from 'class-validator';
import { WorkoutStatsQuery } from '@sunsteel/contracts';

export class WorkoutStatsQueryDto implements WorkoutStatsQuery {
  @IsISO8601({ strict: true })
  weekStart!: string;

  @IsISO8601({ strict: true })
  weekEnd!: string;

  @IsTimeZone()
  timeZone!: string;
}
