import {
  ONBOARDING_STEP_ID_PATTERN_SOURCE,
  ONBOARDING_STEPS_MAX,
  ONBOARDING_VERSION_MAX,
  type UpdateOnboardingRequest,
} from '@sunsteel/contracts';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** ONBOARD-01: progress through onboarding, written partially. */
export class UpdateOnboardingDto implements UpdateOnboardingRequest {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ONBOARDING_STEPS_MAX)
  @Matches(new RegExp(ONBOARDING_STEP_ID_PATTERN_SOURCE), { each: true })
  stepsDone?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(ONBOARDING_VERSION_MAX)
  completedVersion?: number;

  @IsOptional()
  @Equals(true)
  offered?: true;
}
