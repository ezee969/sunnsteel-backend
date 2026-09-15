import { IsNotEmpty, IsString, Matches } from 'class-validator';
import {
  MoveOccurrenceRequest,
  ScheduleOverridesQuery,
} from '@sunsteel/contracts';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = '$property must be a YYYY-MM-DD date';

export class MoveOccurrenceDto implements MoveOccurrenceRequest {
  @IsString()
  @IsNotEmpty()
  routineId: string;

  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  date: string;

  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  toDate: string;
}

export class ScheduleOverridesQueryDto implements ScheduleOverridesQuery {
  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  from: string;

  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  to: string;
}
