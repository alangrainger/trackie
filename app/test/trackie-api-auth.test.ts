/*
Unit tests for the password-only API client login intercept's decision logic.
These enforce the security properties: an expired token must never mint, a
minted 'api' session must never mint again (no chain-minting), and non-token
passwords must fall through to upstream untouched.

Run: node --experimental-strip-types --test app/test/trackie-api-auth.test.ts
*/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  API_AUTH_METHOD,
  TOKEN_EXPIRATION_NEVER,
  decideApiLogin,
  isCandidateToken,
  mintExpiresAt,
} from '../overlay/packages/sync-server/src/accounts/trackie-api-auth.ts';

const NOW_MS = 1_750_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

/** A valid, unexpired OIDC session row, overridable per test. */
function openidSession(overrides = {}) {
  return {
    user_id: 'user-1',
    auth_method: 'openid',
    expires_at: NOW_S + 3600,
    ...overrides,
  };
}

test('only non-empty strings of plausible length are candidate tokens', () => {
  assert.equal(isCandidateToken('4b3a1c1e-6f2d-4d3c-9d5e-8a7b6c5d4e3f'), true);

  // Everything JSON can smuggle into `password` must be refused before the DB
  // lookup: objects/arrays would throw on parameter binding.
  for (const bad of ['', null, undefined, 42, true, {}, [], { a: 1 }]) {
    assert.equal(isCandidateToken(bad), false, `expected refusal: ${JSON.stringify(bad)}`);
  }
  assert.equal(isCandidateToken('x'.repeat(201)), false, 'over-length string');
});

test('a valid, unexpired openid session mints for its own user', () => {
  const decision = decideApiLogin(openidSession(), NOW_MS);
  assert.deepEqual(decision, { action: 'mint', userId: 'user-1' });
});

test('a never-expiring openid session mints', () => {
  const decision = decideApiLogin(
    openidSession({ expires_at: TOKEN_EXPIRATION_NEVER }),
    NOW_MS,
  );
  assert.equal(decision.action, 'mint');
});

test('an unknown token falls through', () => {
  assert.deepEqual(decideApiLogin(null, NOW_MS), { action: 'ignore' });
  assert.deepEqual(decideApiLogin(undefined, NOW_MS), { action: 'ignore' });
});

test('an expired openid session must not mint', () => {
  // Expired rows linger in the sessions table (upstream reaps lazily); a
  // long-dead token bootstrapping a fresh 90-day session would defeat expiry.
  const atExpiry = decideApiLogin(openidSession({ expires_at: NOW_S }), NOW_MS);
  assert.deepEqual(atExpiry, { action: 'expired' }, 'expires_at == now is expired');

  const longDead = decideApiLogin(
    openidSession({ expires_at: NOW_S - 90 * 24 * 3600 }),
    NOW_MS,
  );
  assert.deepEqual(longDead, { action: 'expired' });
});

test('a minted api session must never mint again (no chain-minting)', () => {
  // Without this, one leaked token could renew itself forever.
  const decision = decideApiLogin(
    openidSession({ auth_method: API_AUTH_METHOD }),
    NOW_MS,
  );
  assert.deepEqual(decision, { action: 'ignore' });

  // Same for any other non-openid method, expired or not.
  const password = decideApiLogin(
    openidSession({ auth_method: 'password' }),
    NOW_MS,
  );
  assert.deepEqual(password, { action: 'ignore' });
});

test('minted expiry follows token_expiration config', () => {
  // Trackie's deployed value: 90 days in seconds.
  assert.equal(mintExpiresAt(7776000, NOW_MS), NOW_S + 7776000);
  assert.equal(mintExpiresAt('never', NOW_MS), TOKEN_EXPIRATION_NEVER);

  // 'openid-provider', unset, or garbage all fall back to 90 days - never to
  // upstream's 10-minute default, which would be useless for an API credential.
  const fallback = NOW_S + 90 * 24 * 3600;
  assert.equal(mintExpiresAt('openid-provider', NOW_MS), fallback);
  assert.equal(mintExpiresAt(undefined, NOW_MS), fallback);
  assert.equal(mintExpiresAt(-5, NOW_MS), fallback);
});
