import {
  PROFILE_VISIBILITY_VALUES,
  ProfileVisibility,
  UpdateProfilePrivacyRequest,
} from '@sunsteel/contracts';
import { IsIn } from 'class-validator';

export class UpdateProfilePrivacyDto implements UpdateProfilePrivacyRequest {
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
