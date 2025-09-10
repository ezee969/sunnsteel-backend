import { IsEmail, IsString, MinLength } from 'class-validator';

export class EmailDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;
}

export class RegisterDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;

  @IsString()
  name: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsString()
  password: string;
}

export class GoogleAuthDto {
  @IsString()
  idToken: string;
}
