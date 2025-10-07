/**
 * Centralized validation constants for backend
 * These should match frontend validation and Supabase configuration
 */

export const VALIDATION_CONSTANTS = {
  // Password validation (must match Supabase settings)
  PASSWORD_MIN_LENGTH: 6,
  PASSWORD_MAX_LENGTH: 128,

  // Name validation
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 100,

  // Email validation
  EMAIL_MAX_LENGTH: 255,
} as const;

export const VALIDATION_MESSAGES = {
  // Password messages
  PASSWORD_TOO_SHORT: `Password must be at least ${VALIDATION_CONSTANTS.PASSWORD_MIN_LENGTH} characters`,
  PASSWORD_TOO_LONG: `Password must not exceed ${VALIDATION_CONSTANTS.PASSWORD_MAX_LENGTH} characters`,

  // Name messages
  NAME_TOO_SHORT: `Name must be at least ${VALIDATION_CONSTANTS.NAME_MIN_LENGTH} characters`,
  NAME_TOO_LONG: `Name must not exceed ${VALIDATION_CONSTANTS.NAME_MAX_LENGTH} characters`,

  // Email messages
  EMAIL_INVALID: 'Invalid email format',
} as const;
