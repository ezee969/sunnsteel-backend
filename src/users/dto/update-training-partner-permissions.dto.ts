import type {
  UpdateTrainingPartnerPermissionsRequest,
} from '@sunsteel/contracts';
import { IsBoolean } from 'class-validator';

export class UpdateTrainingPartnerPermissionsDto
  implements UpdateTrainingPartnerPermissionsRequest
{
  @IsBoolean()
  schedule!: boolean;

  @IsBoolean()
  progress!: boolean;

  @IsBoolean()
  activity!: boolean;

  @IsBoolean()
  routines!: boolean;

  @IsBoolean()
  encouragement!: boolean;
}
