/**
 * Decision logic for the password-only API client login intercept
 *
 * Trackie enforces OIDC, so password-based API clients (actual-mcp and
 * anything else built on @actual-app/api) cannot log in. The intercept in
 * app-apiaccess.ts accepts a valid session token as the "password" and mints a
 * fresh session for the same user. This module holds the security-critical
 * decisions - what counts as a candidate token, which sessions may mint, and
 * what expiry a minted session gets - as pure, dependency-free functions so
 * they are unit testable in isolation (`node --test`), the same pattern as
 * trackie-identity.ts.
 */

/** `expires_at` sentinel for sessions that never expire (upstream convention). */
export const TOKEN_EXPIRATION_NEVER = -1;

/** Minted sessions are tagged with this `auth_method`, distinguishing them from
 * upstream's 'openid'/'password' sessions and - critically - making them
 * ineligible to mint further sessions (no chain-minting: a minted token must
 * not be able to renew itself forever and defeat expiry). */
export const API_AUTH_METHOD = 'api';

/* Sanity cap on the intercepted password. Real session tokens are 36-char
   UUIDs; anything much longer is not a token and is not worth a DB lookup. */
const MAX_CANDIDATE_LENGTH = 200;

/** The subset of an upstream `sessions` row the decision needs. */
export type SessionRow = {
  user_id: string;
  auth_method: string;
  expires_at: number;
};

/** Outcome of evaluating an intercepted login attempt. */
export type ApiLoginDecision =
  /** Not our case - fall through to upstream's handler untouched. */
  | { action: 'ignore' }
  /** The token was a real login session but has expired; tell the user
   * clearly so a re-paste of a dead token does not surface as upstream's
   * confusing "Invalid redirect URL". */
  | { action: 'expired' }
  /** Mint a fresh API session for this user. */
  | { action: 'mint'; userId: string };

/**
 * Is the submitted password worth looking up as a session token?
 *
 * Guards the DB lookup: only non-empty strings of plausible length qualify.
 * JSON can carry objects/arrays/numbers in `password`, which must fall through
 * untouched (upstream deals with them) rather than reach parameter binding.
 */
export function isCandidateToken(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length > 0 &&
    password.length <= MAX_CANDIDATE_LENGTH
  );
}

/**
 * Decide what an intercepted login attempt should do, given the session row
 * the submitted token matched (or null/undefined for no match).
 *
 * Only sessions minted by a real OIDC login may mint: 'api' sessions are
 * refused (no chain-minting) and fall through as if the password were wrong.
 * Expiry is checked here because expired rows can linger in the sessions
 * table - upstream only reaps them lazily (clearExpiredSessions() runs on the
 * next successful OIDC login, with a one-hour grace) - and a long-dead token
 * must not bootstrap a fresh 90-day session.
 */
export function decideApiLogin(
  session: SessionRow | null | undefined,
  nowMs: number,
): ApiLoginDecision {
  if (!session || session.auth_method !== 'openid') {
    return { action: 'ignore' };
  }

  if (
    session.expires_at !== TOKEN_EXPIRATION_NEVER &&
    session.expires_at * 1000 <= nowMs
  ) {
    return { action: 'expired' };
  }

  return { action: 'mint', userId: session.user_id };
}

/**
 * Compute `expires_at` (unix seconds) for a minted API session from the
 * server's `token_expiration` config, mirroring upstream's openid.ts:
 * a number of seconds from now, or 'never'. The 'openid-provider' setting has
 * no meaning here (there is no IdP token set on this path), so it and any
 * other value fall back to upstream's numeric default of 90 days - the same
 * value Trackie deploys with (ACTUAL_TOKEN_EXPIRATION=7776000).
 */
export function mintExpiresAt(tokenExpiration: unknown, nowMs: number): number {
  const nowSeconds = Math.floor(nowMs / 1000);
  if (tokenExpiration === 'never') {
    return TOKEN_EXPIRATION_NEVER;
  }
  if (typeof tokenExpiration === 'number' && tokenExpiration > 0) {
    return nowSeconds + tokenExpiration;
  }
  return nowSeconds + 90 * 24 * 60 * 60;
}
