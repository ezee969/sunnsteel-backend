import {
  PROFILE_VISIBILITY_VALUES,
  ProfileVisibility,
  UpdateProfilePrivacyRequest,
} from '@sunsteel/contracts';
import { IsIn, IsOptional } from 'class-validator';

export class UpdateProfilePrivacyDto implements UpdateProfilePrivacyRequest {
  @IsOptional()
  @IsIn(PROFILE_VISIBILITY_VALUES)
  biography?: ProfileVisibility;

  @IsOptional()
  @IsIn(PROFILE_VISIBILITY_VALUES)
  location?: ProfileVisibility;

  @IsOptional()
  @IsIn(PROFILE_VISIBILITY_VALUES)
  trainingIdentity?: ProfileVisibility;

  @IsIn(PROFILE_VISIBILITY_VALUES)
  workoutHistory!: ProfileVisibility;

  @IsIn(PROFILE_VISIBILITY_VALUES)
  records!: ProfileVisibility;

  @IsIn(PROFILE_VISIBILITY_VALUES)
  routines!: ProfileVisibility;

  @IsIn(PROFILE_VISIBILITY_VALUES)
  achievements!: ProfileVisibility;

  @IsIn(PROFILE_VISIBILITY_VALUES)
  bodyMetrics!: ProfileVisibility;
}
