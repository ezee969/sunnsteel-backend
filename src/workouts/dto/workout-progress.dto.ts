import { IsTimeZone } from 'class-validator';

export class WorkoutProgressQueryDto {
  @IsTimeZone()
  timeZone!: string;
}
