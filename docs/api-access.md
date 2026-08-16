# Connecting other tools (API access)

Trackie works with tools built on the official
[Actual Budget API](https://actualbudget.org/docs/api/) (`@actual-app/api`) -
for example [actual-mcp](https://github.com/s-stefanov/actual-mcp), which lets
an AI assistant read and analyse your budget. This page explains how to connect
such a tool to your Trackie account, and what to know before you do.

These tools normally sign in with a server URL and a password. Trackie has no
passwords - you sign in with a one-time email code - so instead it gives you a
personal **API token** that these tools accept in place of a password. No
changes to the tool are needed.

## Get your token

1. Sign in at [app.trackie.nz](https://app.trackie.nz) as usual.
2. Visit [app.trackie.nz/account/api-token](https://app.trackie.nz/account/api-token).
3. Copy the ready-made settings shown there.

## Configure your tool

The page gives you the two settings every API tool needs:

```
ACTUAL_SERVER_URL=https://app.trackie.nz
ACTUAL_PASSWORD=<your token>
```

Some tools also ask for:

- **Sync ID** - your budget's identifier. In the app, open Settings, choose
  "Show advanced settings", and copy the Sync ID.
- **Encryption password** - only if you have turned on end-to-end encryption
  for your budget. The tool needs it to decrypt your data (for actual-mcp this
  is `ACTUAL_BUDGET_ENCRYPTION_PASSWORD`). Trackie never has this password and
  cannot supply or recover it.

## Keep your token safe

- **Treat it exactly like a password.** It gives full access to your budget.
  Never share it with anyone - including anyone claiming to be Trackie
  support. Nobody legitimate will ever ask for it.
- Only put it into tools you run yourself and trust. A tool holding your token
  can read and change everything in your budget.
- A token only ever reaches **your own** budget - it cannot see anyone else's.
- Tokens **expire after 90 days**. When a tool stops authenticating, visit the
  token page again and copy a fresh one.
- If you think a token has leaked, contact support (Help menu in the app) and
  it will be revoked.

## How it works

For the curious - the mechanism is small and, like the rest of Trackie's
changes, public and auditable:

- Signing in to the app creates a login session on the server. The token page
  simply shows you that session's token - it is served from the app's own
  domain, so only your signed-in browser can read it.
- When an API tool "logs in with a password", the server checks whether the
  password is a valid, unexpired login token. If it is, it issues the tool a
  fresh 90-day API session for your account and nothing else. Anything else
  falls through to the normal sign-in flow unchanged.
- Only a real sign-in session can create an API session. API sessions cannot
  create further sessions, so a token can never renew itself forever - after
  90 days it dies unless you, signed in, hand the tool a fresh one.

The implementation is
[`app-apiaccess.ts`](../app/overlay/packages/sync-server/src/app-apiaccess.ts),
with the security rules in
[`trackie-api-auth.ts`](../app/overlay/packages/sync-server/src/accounts/trackie-api-auth.ts)
enforced by unit tests.
