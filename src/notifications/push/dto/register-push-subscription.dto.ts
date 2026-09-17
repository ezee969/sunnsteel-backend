import type {
  PushSubscriptionKeys,
  RegisterPushSubscriptionRequest,
} from '@sunsteel/contracts';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class PushSubscriptionKeysDto implements PushSubscriptionKeys {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth!: string;
}

export class RegisterPushSubscriptionDto
  implements RegisterPushSubscriptionRequest
{
  /**
   * A push endpoint is an https URL at the browser vendor's service. Rejecting
   * anything else keeps the server from being pointed at an arbitrary host.
   */
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  endpoint!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expirationTime!: number | null;

  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}
