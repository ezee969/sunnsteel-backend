import type { DeleteAccountRequest } from '@sunsteel/contracts';
import { IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto implements DeleteAccountRequest {
  @IsString()
  @MaxLength(64)
  confirmUsername!: string;
}
