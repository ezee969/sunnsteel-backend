import { WorkoutProgressQuery } from '@sunsteel/contracts';
import { IsTimeZone } from 'class-validator';

export class WorkoutProgressQueryDto implements WorkoutProgressQuery {
  @IsTimeZone()
  timeZone!: string;
}
