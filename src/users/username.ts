import { createHash } from 'node:crypto';

import {
  RESERVED_USERNAMES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN_SOURCE,
} from '@sunsteel/contracts';

const USERNAME_PATTERN = new RegExp(USERNAME_PATTERN_SOURCE);
const RESERVED_USERNAME_SET = new Set<string>(RESERVED_USERNAMES);

export type UsernameValidationError = 'INVALID_FORMAT' | 'RESERVED' | null;

export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

export function getUsernameValidationError(
  value: string,
): UsernameValidationError {
  const username = normalizeUsername(value);
  if (
    username.length < USERNAME_MIN_LENGTH ||
    username.length > USERNAME_MAX_LENGTH ||
    !USERNAME_PATTERN.test(username)
  ) {
    return 'INVALID_FORMAT';
  }
  return RESERVED_USERNAME_SET.has(username) ? 'RESERVED' : null;
}

export function createInitialUsername(
  displayName: string,
  seed: string,
): string {
  const suffix = createHash('sha256').update(seed).digest('hex').slice(0, 12);
  const maxBaseLength = USERNAME_MAX_LENGTH - suffix.length - 1;
  const normalizedName = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxBaseLength)
    .replace(/_+$/g, '');
  const base =
    normalizedName.length >= USERNAME_MIN_LENGTH &&
    !RESERVED_USERNAME_SET.has(normalizedName)
      ? normalizedName
      : 'member';

  return `${base}_${suffix}`;
}
