import {
  TRAINING_PARTNER_ENCOURAGEMENT_KINDS,
  type SendTrainingPartnerEncouragementRequest,
  type TrainingPartnerEncouragementKind,
} from '@sunsteel/contracts';
import { IsIn } from 'class-validator';

export class SendTrainingPartnerEncouragementDto
  implements SendTrainingPartnerEncouragementRequest
{
  @IsIn([...TRAINING_PARTNER_ENCOURAGEMENT_KINDS])
  kind!: TrainingPartnerEncouragementKind;
}
