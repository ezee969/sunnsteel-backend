import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import {
  VALIDATION_CONSTANTS,
  VALIDATION_MESSAGES,
} from '../../common/constants/validation.constants';

export class EmailDto {
  @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
  email: string;
}

/**
 * @deprecated This DTO is deprecated in favor of Supabase authentication.
 * Kept for backward compatibility with legacy code.
 */
export class RegisterDto {
  @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
  email: string;

  @IsString()
  @MinLength(VALIDATION_CONSTANTS.PASSWORD_MIN_LENGTH, {
    message: VALIDATION_MESSAGES.PASSWORD_TOO_SHORT,
  })
  @MaxLength(VALIDATION_CONSTANTS.PASSWORD_MAX_LENGTH, {
    message: VALIDATION_MESSAGES.PASSWORD_TOO_LONG,
  })
  password: string;

  @IsString()
  @MinLength(VALIDATION_CONSTANTS.NAME_MIN_LENGTH, {
    message: VALIDATION_MESSAGES.NAME_TOO_SHORT,
  })
  @MaxLength(VALIDATION_CONSTANTS.NAME_MAX_LENGTH, {
    message: VALIDATION_MESSAGES.NAME_TOO_LONG,
  })
  name: string;
}

export class LoginDto {
  @IsEmail({}, { message: VALIDATION_MESSAGES.EMAIL_INVALID })
  email: string;

  @IsString()
  @MinLength(VALIDATION_CONSTANTS.PASSWORD_MIN_LENGTH, {
    message: VALIDATION_MESSAGES.PASSWORD_TOO_SHORT,
  })
  password: string;
}

export class GoogleAuthDto {
  @IsString()
  idToken: string;
}
