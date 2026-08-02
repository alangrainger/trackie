# Security and privacy

How Trackie ([trackie.nz](https://trackie.nz)) is built to protect users' financial
data: the architecture, the trust model, and the specific measures around login, data
isolation, and NZ bank sync. Written for technically-minded users.

## Contents

- [Summary](#summary)
- [Architecture](#architecture)
- [Identity and login](#identity-and-login)
- [Per-user isolation](#per-user-isolation)
- [End-to-end encryption of budgets](#end-to-end-encryption-of-budgets)
- [NZ bank sync (Akahu)](#nz-bank-sync-akahu)
- [Network and hosting](#network-and-hosting)
- [Data retention and deletion](#data-retention-and-deletion)
- [Transparency](#transparency)
- [Reporting a vulnerability](#reporting-a-vulnerability)

## Summary

- The service is standard [Actual Budget](https://actualbudget.org) plus a small,
  public overlay: privacy-preserving sign-in, a deny-by-default admin gateway, a
  one-click sign-in deep link, and optional per-user NZ bank sync.
- **Bank sync is optional.** The app is fully usable with manual statement import and
  no bank connection at all. When used, each user connects their own read-only Akahu
  tokens, stored encrypted at rest - see [NZ bank sync (Akahu)](#nz-bank-sync-akahu).
  See also
  [about-this-service.md](about-this-service.md#you-do-not-need-to-connect-a-bank).
- Login is delegated to a specialist identity provider over OpenID Connect; **the
  service never receives or stores user passwords.**
- **No plaintext email is stored.** Each user is keyed on an irreversible
  `HMAC-SHA256(verified_email, secret)` token and the display-name column is stored
  empty, so no column in the account database holds a recoverable email or name. This
  is enforced by automated tests in CI, not only asserted here.
- Each user's budget and any bank connection are isolated to that user.
- Access is restricted to New Zealand and served only over HTTPS.

## Architecture

```
        NZ user's browser
              |
   (Cloudflare: NZ-only geoblock, TLS, rate limiting)
              |
   +----------+------------------------+
   |                                   |
app.trackie.nz                     auth.trackie.nz (self-hosted Logto)
[Actual sync-server + NZ overlay]  [login, email verification, optional MFA]
   |  OpenID multi-user mode
   |  per-user budget files
```

The identity provider owns "who can log in" (sign-up, email verification, optional
MFA). Actual owns budgets and creates a local user the first time someone logs in.
The NZ overlay adds the HMAC identity handling below.

## Identity and login

- **OpenID Connect** (`ACTUAL_LOGIN_METHOD=openid`, `ACTUAL_OPENID_ENFORCE=true`).
  Password login is disabled; everyone authenticates through the identity provider.
- **No passwords stored here.** The service never sees a user's password. The provider
  verifies the user and returns only an identity assertion. Email verification and
  bot/abuse detection live at the identity provider.
- **Identity is an HMAC of the verified email, not the raw email.** Upstream Actual stores the user's email address as the ID, we store only an HMAC in the Actual Budget tables to prevent linking budget data to any PII.

## Per-user isolation

- Multi-user OpenID mode gives every person their own `users` row, role, and **own
  budget files**. There is no shared budget.
- **The `/admin` namespace is deny-by-default.** Upstream Actual exposes a user directory
  and file-sharing endpoints under `/admin`; in a multi-tenant deployment those must not be
  reachable by ordinary users. A gateway (`trackieAdminGuard`) sits ahead of the admin router and
  rejects every `/admin` request from a non-admin session, with a single allow-listed
  exception: the unauthenticated owner-created check the login page needs. Any endpoint a
  future upstream release adds under `/admin` is therefore closed by default until it is
  consciously allow-listed - so a new upstream feature cannot silently leak across tenants.
- **Budget sharing is switched off entirely.** Upstream lets a
  file owner or admin grant another user access to a budget, and transfer its ownership. Trackie
  refuses all five of those endpoints (`/admin/access*`) outright, before any session or role is
  even examined, so the refusal cannot depend on who is asking. The matching UI - the "User
  Access Management" menu entry and the `/user-access` page - is removed from the client, and
  the page is not shipped in the built bundle at all.

## End-to-end encryption of budgets

Actual supports optional client-side end-to-end encryption. A user who turns it on
sets a personal encryption password; their budget is encrypted **on their device**
before sync, and the server stores only salted key metadata - it cannot read the
budget contents.

- This is **separate from login** and is the user's choice.
- **There is no password recovery.** If the encryption password is lost, the data
  cannot be decrypted by anyone, including the operator. Onboarding copy states this
  clearly.

## NZ bank sync (Akahu)

Connecting a bank is **optional** - the app works fully with manual import. When a
user does connect, Trackie uses [Akahu](https://www.akahu.nz/), New Zealand's
open-banking provider, under a **per-user personal-token** model:

- **Each user brings their own Akahu tokens.** The user creates their own
  [my.akahu.nz](https://my.akahu.nz) developer account and pastes their personal
  **App ID Token** and **User Access Token** into Trackie. There is no shared
  operator Akahu application; every API call uses the calling user's own tokens.
- **Read-only.** The integration only lists accounts and reads transactions
  (`accounts.list`, `listTransactions`, `listPendingTransactions`, `refreshAll`).
  There is no code path that can initiate a payment or move money.
- **Tokens are encrypted at rest.** Both tokens are sealed with AES-256-GCM under a
  key derived (HKDF-SHA256) from a server-only secret (`ACTUAL_AKAHU_TOKEN_SECRET`),
  stored one row per user keyed on the user id, deleted when the user disconnects or
  their account is removed, and never written to logs. A leaked database file alone
  does not expose them, because the key lives only in the server environment.
- **An honest trust note.** The server must decrypt these tokens to call Akahu on the
  user's behalf, so the operator *technically* holds a decryptable - but **read-only**
  - bank credential for each connected user. This is a real trust placement and we
  state it plainly rather than imply the operator can never see it. It is also why the
  connection is read-only and why connecting a bank is never required.
- **Polite, on-demand refresh.** Sync runs only when the user's own client opens or
  syncs their budget - there is no background polling - and refreshes a given account
  at most once every 20 hours. Someone who has been away simply gets a refresh on
  their next visit.
- **Per-user isolation.** Every endpoint derives the user from the validated session,
  never from client input, so a user can only ever reach their own Akahu accounts, and
  removing a user cascades away their stored connection.

## Network and hosting

- **HTTPS everywhere**, terminated at Cloudflare; TLS to the origin.
- **NZ-only** via a Cloudflare country rule on the app and a post-login rule at the
  identity provider.
- **Rate limiting** at Cloudflare on login and sign-up paths; `ACTUAL_TRUSTED_PROXIES`
  set to Cloudflare ranges so the origin sees real client IPs.
- Self-hosted origin; `account.sqlite` and user budget files are kept on local disk
  with restricted access and regular, privately-held backups.

## Data retention and deletion

- Users can export their full budget at any time (no lock-in) and disconnect any bank
  connection at any time.
- Removing a user removes their budget files.
- Dormant/empty accounts may be cleaned up periodically as part of abuse and storage
  management.

## Transparency

The entire diff from upstream Actual Budget is published in this repository and is
intentionally small: privacy sign-in (HMAC identity), the deny-by-default `/admin` gateway,
the `/get-started` deep link, and per-user NZ bank sync (Akahu). There is no analytics,
tracking, or telemetry added. Anyone can
read the drop-in modules under `app/overlay/`, the `app/patches/` diffs, and
`app/apply-overlay.sh` to confirm exactly what runs.

## Reporting a vulnerability

If you find a security issue, please report it privately to the operator rather than
opening a public issue, so it can be fixed before disclosure. See
[SECURITY.md](../SECURITY.md) for the disclosure address and scope.
