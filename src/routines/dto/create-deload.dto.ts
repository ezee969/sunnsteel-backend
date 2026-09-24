import { IsIn, Matches } from 'class-validator';
import {
  DELOAD_LOAD_REDUCTIONS,
  DELOAD_SET_MODES,
  type CreateDeloadRequest,
  type DeloadLoadReduction,
  type DeloadSetMode,
} from '@sunsteel/contracts';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = '$property must be a YYYY-MM-DD date';

export class CreateDeloadDto implements CreateDeloadRequest {
  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  startDate: string;

  @Matches(CALENDAR_DATE, { message: DATE_MESSAGE })
  endDate: string;

  @IsIn(DELOAD_LOAD_REDUCTIONS as unknown as number[])
  loadReductionPercent: DeloadLoadReduction;

  @IsIn(DELOAD_SET_MODES as unknown as string[])
  setMode: DeloadSetMode;
}
