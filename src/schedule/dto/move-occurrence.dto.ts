import { IsNotEmpty, IsString, Matches } from 'class-validator';
import {
  MoveOccurrenceRequest,
  ScheduleOverridesQuery,
  SkipOccurrenceRequest,
} from '@sunsteel/contracts';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = '$property must be a YYYY-MM-DD date';

export class SkipOccurrenceDto implements SkipOccurrenceRequest {
  @IsString()
  @IsNotEmpty()
  routineId: string;

  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  date: string;
}

export class MoveOccurrenceDto
  extends SkipOccurrenceDto
  implements MoveOccurrenceRequest
{
  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  toDate: string;
}

export class ScheduleOverridesQueryDto implements ScheduleOverridesQuery {
  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  from: string;

  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  to: string;
}
