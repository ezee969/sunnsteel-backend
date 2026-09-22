import { IsNotEmpty, IsString } from 'class-validator';

export class SupabaseVerifyTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
