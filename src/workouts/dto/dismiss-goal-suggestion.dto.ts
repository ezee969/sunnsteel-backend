import type { DismissGoalSuggestionRequest } from "@sunsteel/contracts";
import { IsNumber, IsPositive, IsString, MaxLength } from "class-validator";

/** ACH-06: "Not now" on one suggestion, at the number it suggested. */
export class DismissGoalSuggestionDto implements DismissGoalSuggestionRequest {
  @IsString()
  @MaxLength(120)
  key!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  targetValue!: number;
}
