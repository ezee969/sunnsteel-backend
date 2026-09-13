import type { SessionComparisonQuery } from "@sunsteel/contracts";
import { IsOptional, IsUUID } from "class-validator";

export class SessionComparisonQueryDto implements SessionComparisonQuery {
  @IsOptional()
  @IsUUID()
  routineDayId?: string;
}
