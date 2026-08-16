// @ts-strict-ignore
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { getAccountDb, getSession } from '#account-db';
import {
  API_AUTH_METHOD,
  decideApiLogin,
  isCandidateToken,
  mintExpiresAt,
} from '#accounts/trackie-api-auth';
import { config } from '#load-config';

const app = express();
export { app as handlers };

/*
API access for password-only clients. This is so projects like `actual-mcp`
which don't support OIDC token access, can still work with Trackie.

Mounted at /account AHEAD of upstream's account router (app-mounts.patch), so
these routes win and everything else falls through to upstream unchanged.

Two routes:
- POST /account/login: if the submitted "password" is a valid OIDC session
  token, mint a fresh per-user API session and return it in the exact shape
  @actual-app/api expects - unmodified password-based clients (actual-mcp et
  al) then work against Trackie. Anything else falls through to upstream, so
  browsers still get the OIDC flow.
- GET /account/api-token: a page where a signed-in user reads their session
  token to use as ACTUAL_PASSWORD. Served under /account deliberately: the
  client's workbox service worker rewrites navigations to the SPA
  (navigateFallback) except for a denylist of prefixes, and /account/* is on
  it - a top-level /api-token would be swallowed by the SW for exactly the
  users who need it.

The mint/expiry/no-chain-minting decisions live in accounts/trackie-api-auth.ts
(pure, unit-tested); this file is the express + DB glue.
 */

/**
 * POST /account/login - session-token-as-password intercept.
 *
 * The decision logic (see trackie-api-auth.ts) only mints from a valid,
 * unexpired 'openid' session: minted 'api' sessions cannot mint again, and a
 * matched-but-expired login token gets a clear 'token-expired' instead of
 * upstream's confusing "Invalid redirect URL". A fresh session (not an echo of
 * the browser's token) means the API credential survives a browser logout and
 * gets its own expiry clock.
 */
app.post('/login', (req, res, next) => {
  try {
    const password = req.body?.password;
    if (!isCandidateToken(password)) {
      next();
      return;
    }

    const decision = decideApiLogin(getSession(password), Date.now());

    if (decision.action === 'expired') {
      res.status(401).send({ status: 'error', reason: 'token-expired' });
      return;
    }
    if (decision.action !== 'mint') {
      next();
      return;
    }

    const token = uuidv4();
    getAccountDb().mutate(
      'INSERT INTO sessions (token, expires_at, user_id, auth_method) VALUES (?, ?, ?, ?)',
      [
        token,
        mintExpiresAt(config.get('token_expiration'), Date.now()),
        decision.userId,
        API_AUTH_METHOD,
      ],
    );

    res.send({ status: 'ok', data: { token } });
  } catch (err) {
    // Fail open to upstream's handler - this intercept must never be the
    // reason a login 500s.
    console.error('[api-access] login intercept failed:', err);
    next();
  }
});

/**
 * The page served at GET /account/api-token.
 *
 * Entirely client-side: an inline script reads the signed-in user's session
 * token from the web client's IndexedDB (database 'actual', object store
 * 'asyncStorage', key 'user-token' - what loot-core's asyncStorage writes on
 * login) and shows it with a ready-made env snippet. Same-origin policy is the
 * access control: the browser only hands the token to pages on the app's own
 * origin, and the server embeds no values in the page, so there is no
 * injection surface. If the key is missing the user is pointed at /login.
 * NOTE: this couples to the web client's IndexedDB layout the same way
 * app-getstarted.ts does; if upstream renames the db/store/key the page
 * degrades to its "not signed in" state, never to a worse one.
 */
function apiTokenPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Trackie - API token</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
  h1 { font-size: 1.4rem; }
  pre { background: #f4f4f4; border: 1px solid #ddd; border-radius: 6px; padding: 0.8rem; overflow-x: auto; }
  code { word-break: break-all; }
  button { font: inherit; padding: 0.3rem 0.9rem; border-radius: 6px; border: 1px solid #bbb; background: #fff; cursor: pointer; }
  button:hover { background: #f0f0f0; }
  .warn { background: #fff3e0; border: 1px solid #ffcc80; border-radius: 6px; padding: 0.8rem; }
  .hidden { display: none; }
</style>
</head>
<body>
<h1>Your API token</h1>

<div id="signed-out" class="hidden">
  <p>You are not signed in on this browser. <a href="/login">Sign in</a>, then come back to this page.</p>
</div>

<div id="signed-in" class="hidden">
  <p class="warn"><strong>Treat this token like a password.</strong> It gives full
  access to your budget. Never share it with anyone - including anyone claiming
  to be Trackie support. Nobody legitimate will ever ask you for it.</p>

  <p>Use it as the <em>password</em> for API tools built on
  <code>@actual-app/api</code>, such as
  <a href="https://github.com/s-stefanov/actual-mcp" rel="noopener">actual-mcp</a>:</p>

  <pre><code id="snippet"></code></pre>
  <p><button id="copy">Copy</button> <span id="copied" class="hidden">Copied.</span></p>

  <p>Your budget's <strong>Sync ID</strong> (some tools ask for it) is in the app
  under Settings &gt; Show advanced settings &gt; Sync ID.</p>

  <p>The token expires after 90 days; when a tool stops authenticating, sign in
  here again and copy a fresh one. It keeps working even if you log out of the
  app on this browser.</p>
</div>

<script>
(function () {
  function show(id) { document.getElementById(id).classList.remove('hidden'); }
  function signedOut() { show('signed-out'); }
  try {
    // Open without a version: never upgrades or creates stores, just reads
    // whatever the web client has persisted.
    var req = indexedDB.open('actual');
    req.onerror = signedOut;
    req.onsuccess = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('asyncStorage')) { db.close(); signedOut(); return; }
      var get = db.transaction(['asyncStorage'], 'readonly')
        .objectStore('asyncStorage')
        .get('user-token');
      get.onerror = function () { db.close(); signedOut(); };
      get.onsuccess = function () {
        var token = get.result;
        db.close();
        if (typeof token !== 'string' || !token) { signedOut(); return; }
        var snippet = 'ACTUAL_SERVER_URL=' + window.location.origin + '\\n' +
                      'ACTUAL_PASSWORD=' + token;
        document.getElementById('snippet').textContent = snippet;
        show('signed-in');
        document.getElementById('copy').addEventListener('click', function () {
          navigator.clipboard.writeText(snippet).then(function () {
            show('copied');
          });
        });
      };
    };
  } catch (err) { signedOut(); }
})();
</script>
</body>
</html>`;
}

app.get('/api-token', (_req, res) => {
  res
    .set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    )
    .set('X-Frame-Options', 'DENY')
    .set('X-Robots-Tag', 'noindex')
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(apiTokenPage());
});
