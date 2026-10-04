import {
  type UpdateWeekStartRequest,
  WEEK_STARTS,
  type WeekStartsOn,
} from '@sunsteel/contracts';
import { IsIn } from 'class-validator';

/** PREF-04: 1 Monday or 0 Sunday. */
export class UpdateWeekStartDto implements UpdateWeekStartRequest {
  @IsIn(WEEK_STARTS)
  weekStartsOn!: WeekStartsOn;
}
