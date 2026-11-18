import { randomBytes } from 'node:crypto';
import type { ConsumerRequestKind } from '@sunsteel/contracts';

/**
 * BILL-07: the code a request is answered with, which proves it was made.
 * A prefix a person can read on the phone (ARR for arrepentimiento, BAJ for
 * baja), then eight characters from an alphabet without 0/O or 1/I/L, so it
 * can be read aloud and typed back: 40 random bits, `ARR-7KQ2-9XHM`.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX: Record<ConsumerRequestKind, string> = { REVOCATION: 'ARR', CANCELLATION: 'BAJ' };

export const CONSUMER_REQUEST_CODE = /^(ARR|BAJ)-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

export function consumerRequestCode(
  kind: ConsumerRequestKind,
  random: (size: number) => Buffer = randomBytes,
): string {
  const bytes = random(8);
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `${PREFIX[kind]}-${chars.slice(0, 4)}-${chars.slice(4)}`;
}
