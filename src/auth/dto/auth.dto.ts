import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}

export class SupabaseVerifyTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class SupabaseMigrationDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  password!: string;
}
