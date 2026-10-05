import { IsBoolean, IsNumber, Max, Min } from 'class-validator';
import {
  type ContinueLinearBlockRequest,
  LP_REFERENCE_MAX_KG,
} from '@sunsteel/contracts';

/** ROUT-19: what a finished 8-week block does next. */
export class ContinueLinearBlockDto implements ContinueLinearBlockRequest {
  @IsNumber()
  @Min(0.5)
  @Max(LP_REFERENCE_MAX_KG)
  referenceMaxKg: number;

  @IsBoolean()
  recovery: boolean;
}
