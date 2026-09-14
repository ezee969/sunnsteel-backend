import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";
import {
  PLATEAU_MIN_SESSIONS_MAX,
  PLATEAU_MIN_SESSIONS_MIN,
  type PlateauPreferences,
} from "@sunsteel/contracts";

export class UpdatePlateauPreferencesDto implements PlateauPreferences {
  @Type(() => Number)
  @IsInt()
  @Min(PLATEAU_MIN_SESSIONS_MIN)
  @Max(PLATEAU_MIN_SESSIONS_MAX)
  minSessions!: number;
}
