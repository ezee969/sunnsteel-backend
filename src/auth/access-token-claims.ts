/**
 * TD-43. What a protected request trusts about its caller, read from the
 * access token itself instead of from a round trip to Supabase Auth.
 *
 * `supabase.auth.getClaims` proves the token was signed by the project's key
 * (checked against its cached JWKS) and that `exp` has not passed. It does
 * **not** check who the token was issued by, who it was issued for or what
 * role it carries: a token is only a Sunnsteel member's if all of that holds
 * too, so it is checked here. Decoding a token without `getClaims` first would
 * trust anything anyone wrote into it; never call this on unverified claims.
 */

export const ACCESS_TOKEN_AUDIENCE = 'authenticated';
export const ACCESS_TOKEN_ROLE = 'authenticated';

/**
 * The part of a Supabase user the local account is derived from. Every field
 * is present in the access token's claims, which is what lets the guard skip
 * `getUser`.
 */
export type SupabaseIdentity = {
  id: string;
  email?: string;
  user_metadata: Record<string, unknown>;
};

export class InvalidAccessTokenError extends Error {}

/** The `iss` Supabase Auth writes into every token it issues for a project. */
export function supabaseIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The caller's identity, or `InvalidAccessTokenError` naming the first claim
 * that disqualifies the token. `exp` is checked again even though `getClaims`
 * already did, so this function is safe on its own terms.
 */
export function identityFromClaims(
  claims: unknown,
  issuer: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SupabaseIdentity {
  if (!isRecord(claims)) throw new InvalidAccessTokenError('claims');
  const { sub, iss, aud, role, exp, email, user_metadata } = claims;

  if (typeof exp !== 'number' || exp <= nowSeconds) {
    throw new InvalidAccessTokenError('exp');
  }
  if (iss !== issuer) throw new InvalidAccessTokenError('iss');
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(ACCESS_TOKEN_AUDIENCE)) {
    throw new InvalidAccessTokenError('aud');
  }
  // `anon` and `service_role` tokens are signed by the same project and pass
  // every check above; neither is a member.
  if (role !== ACCESS_TOKEN_ROLE) throw new InvalidAccessTokenError('role');
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new InvalidAccessTokenError('sub');
  }

  return {
    id: sub,
    email: typeof email === 'string' && email.length > 0 ? email : undefined,
    user_metadata: isRecord(user_metadata) ? user_metadata : {},
  };
}
