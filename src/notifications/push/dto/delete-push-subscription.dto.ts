import type { DeletePushSubscriptionRequest } from '@sunsteel/contracts';
import { IsUrl, MaxLength } from 'class-validator';

export class DeletePushSubscriptionDto
  implements DeletePushSubscriptionRequest
{
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  endpoint!: string;
}
