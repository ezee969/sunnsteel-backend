import { UpdateProfileDiscoveryRequest } from '@sunsteel/contracts';
import { IsBoolean } from 'class-validator';

export class UpdateProfileDiscoveryDto implements UpdateProfileDiscoveryRequest {
  @IsBoolean()
  discoverableByName!: boolean;

  @IsBoolean()
  discoverableByUsername!: boolean;

  @IsBoolean()
  discoverableByContacts!: boolean;
}
