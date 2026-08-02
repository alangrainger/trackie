# In-place patches

The overlay applies its changes to upstream `actualbudget/actual` in two ways:

- **`overlay/`** holds whole drop-in files (real, type-checked `.ts` compiled by the
  normal build) - the substantive logic lives here.
- **`patches/`** (this folder) holds the few unavoidable *in-place* hooks into upstream
  files, as standard unified diffs applied with `git apply`.

`apply-overlay.sh` copies the drop-ins, then runs `git apply --verbose patches/*.patch`
in alphabetical order against a fresh upstream checkout. `git apply` uses **zero fuzz**,
so if upstream drifts the affected lines, the build **fails loudly** and the patch must be
regenerated - this is the drift detector, no anchor strings to maintain.

## Current patches

Patches apply in alphabetical order. Server-side patches target `packages/sync-server`;
client-side patches target `packages/desktop-client` and `packages/loot-core` and only take
effect in a full client build (not the fast `server.Dockerfile` shortcut).

| Patch | Target | What it does                                                                                                                                                                                                            |
| --- | --- |-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `activity-tracking.patch` | `sync-server/.../util/middlewares.ts` | Emits a first-party active-user signal: one fire-and-forget `recordActivity(session.user_id)` in `validateSessionMiddleware`, the single point every authenticated request already passes through (the logic itself is the `util/trackie-activity.ts` drop-in). No third-party analytics and no per-request cost on the response path. |
| `akahu-app.patch` | `sync-server/.../app-akahu/app-akahu.ts` | Makes upstream's released Akahu router per-user with a surgical hook, *not* a fork: swaps the three `secretsService.get` token reads for `getUserTokens(res.locals.user_id)`, mounts the `/tokens` set/clear routes (both from the `trackie-akahu.ts` drop-in, no upstream transaction-processing code is copied), and widens upstream's own on-demand refresh cap from 1h to 20h (one constant). |
| `akahu-auto-sync-financesapp.patch` | `desktop-client/.../components/FinancesApp.tsx` | Calls the `useAkahuAutoSync` drop-in hook (import + call) so linked bank accounts auto-sync on budget open (logic lives in the `hooks/useAkahuAutoSync.ts` drop-in). Also reworks the update notifications (folded in here to keep one patch per file): gates the service-worker reload popup on `getIsOutdated(getLatestVersion())` so it only shows when a genuinely newer Actual Budget version has shipped (see `update-check-source.patch`), not on every overlay/theme rebuild, and retitles it to "Trackie"; and removes upstream's redundant "Version X was recently released" changelog notice (already inert, since `loot-core-prefs.patch` defaults its opt-in off). |
| `akahu-auto-sync-prefs.patch` | `loot-core/.../types/prefs.ts` | Adds the `akahu-auto-sync-at` key to the `SyncedPrefs` union - the global per-user 20h gate the auto-sync hook reads/writes (synced via the budget CRDT, so shared across the user's devices). |
| `akahu-feature-flag.patch` | `desktop-client/.../hooks/useFeatureFlag.ts` | Defaults the `akahuBankSync` experimental flag to `true` so the Akahu card shows for every Trackie user without the experimental toggle. |
| `akahu-loot-core.patch` | `loot-core/.../accounts/app.ts` | The only patch on this file (one-patch-per-file). Adds the per-user `akahu-set-tokens` / `akahu-clear-tokens` handlers (POST/DELETE to `AKAHU_SERVER + '/tokens'`) plus their type entries. Upstream already registers its own `akahu-accounts` method from v26.7.0, and from v26.8.0 imports `del` itself for its per-budget-file secret clears, so we re-add neither. |
| `akahu-providers.patch` | `desktop-client/.../banksync/useBuiltInBankSyncProviders.ts` | Makes the Akahu card configurable by ordinary users (`canConfigure: true`, since each user manages their own personal token - other providers stay admin-gated), moves it to the front of the list (NZ-first), and repoints its reset to a single `akahu-clear-tokens` call instead of two admin-only `secret-set` clears. Also hides providers a user can neither configure nor link, and gates upstream's admin-permission warning on something actually being left to warn about - from v26.8.0 upstream derives that warning purely from admin/file-owner status, so an ordinary Trackie user (Akahu is self-service) would otherwise always be told to "contact an Admin". The gate wraps the call site; upstream's own `getPermissionWarning` is left untouched so its unit tests still describe real behaviour. |
| `akahu-user-delete.patch` | `sync-server/.../services/user-service.ts` | Deletes the user's `akahu_connections` row inside upstream's own `deleteUser` transaction. The migration declares `ON DELETE CASCADE`, but the sync-server opens SQLite without `PRAGMA foreign_keys = ON`, so the cascade never fires - the encrypted tokens would linger, and because `user_id` is a deterministic HMAC of the email, a deleted-then-re-added user would silently inherit the old bank connection. Deleting explicitly keeps the blast radius inside the overlay instead of enabling FK enforcement globally and changing delete semantics for every declared FK. |
| `app-mounts.patch` | `sync-server/.../app.ts` | Mounts the `/get-started` route and the deny-by-default `trackieAdminGuard` ahead of the `/admin` router, and adds a `Cache-Control` policy to the static serve: everything is pinned immutably for a year except a denylist of stable-URL bootstrap files (`index.html`, `sw.js`, `data-file-index.txt`, `sql-wasm.wasm`) that always revalidate, so the CDN can serve assets off the origin without a deploy ever leaving a browser pinned on a stale client. |
| `bank-sync-labels.patch` | `desktop-client/.../modals/SelectLinkedAccountsModal.tsx` | Rebrands the bank-link modal's account column header from "Account in Actual" to "Account in Trackie", and shows a "Click to select account" placeholder in that column's cells when no local account is yet linked. Display-only. |
| `branding.patch` | `desktop-client/index.html` + `public/site.webmanifest` | Rebrands the browser tab title and PWA `name`/`short_name` from "Actual" to "Trackie".                                                                                                                                  |
| `fatal-error.patch` | `desktop-client/.../components/FatalError.tsx` | Rewrites the `SharedArrayBufferMissing` error copy. Upstream blames the server (missing COOP/COEP headers or no HTTPS), but Trackie's server is correctly configured - the only real cause for our users is an in-app browser (Facebook/Instagram/etc.) that doesn't expose `SharedArrayBuffer`. So the message instead tells them to open the page in their own browser. Editing Actual's own error (which fires on exactly the right condition) is why there is no separate detection script. Keeps upstream's "Advanced options" fallback-mode escape hatch. Display-only. |
| `maintenance-mode.patch` | `desktop-client/.../sync-events.ts` + `components/Titlebar.tsx` | Turns a server outage into a calm notice instead of a sync error. The reverse proxy answers `{"status":"error","reason":"maintenance"}` with a 503 whenever the app container is down, so upstream's own `throwIfNot200` already surfaces it as a `sync-event` of subtype `maintenance` - no patch to `post.ts` needed. This adds the matching case: a sticky "Server maintenance" notice that the sync-success handler clears once the server is back, and an offline (rather than red error) sync icon. Dismissing the notice silences it for the rest of the outage - every local edit schedules a sync a second later (`FULL_SYNC_DELAY`), so otherwise it would spring back the moment the user typed anything, which is precisely what the message invites them to do; the dismissal re-arms only on a `success` sync event (a real server round-trip), never on `applied` (which also fires for local edits). NB: the served `maintenance.json` body must carry a `data` stub shaped like `/needs-bootstrap`'s reply - upstream's `needsBootstrap` dereferences `res.data.bootstrapped` without checking `status`, so parseable JSON without `data` crashes the worker and raises the generic "report this on GitHub" error during the outage (verified empirically against a live client). Only this exact reason triggers it, so the app's own 503s (e.g. Akahu without credentials) still read as real failures. Boot-time session validation needs no change - upstream's `getUser()` already degrades a failed `/validate` to `offline` rather than signing the user out. |
| `openid.patch` | `sync-server/.../accounts/openid.ts` | Imports `trackie-identity`, derives the account identity via `deriveOpenIdIdentity` (HMAC of verified email), stores `display_name` empty, and removes the later-login re-write so no IdP name/email is ever persisted. |
| `prefs-defaults.patch` | `desktop-client/.../prefs/prefsSlice.ts` | Seeds NZ display defaults (DD/MM/YYYY dates, Monday first day of week) at the single `loadPrefs` injection point; a trailing spread lets any saved value win. Display-only.                                             |
| `settings-page.patch` | `desktop-client/.../settings/index.tsx` | Removes the Authentication-method section and the update-notification opt-in checkbox, and rebrands the About tagline to "Trackie". Keeps the Release Notes link.                                        |
| `theme-catalog.patch` | `desktop-client/.../hooks/useThemeCatalog.ts` | Injects a "Trackie" entry into the Global Catalog so a user who has switched to a built-in theme can reinstall Trackie by name; CSS is fetched from the source repo on install. |
| `loot-core-prefs.patch` | `loot-core/.../preferences/app.ts` | Global-pref defaults: seeds the Trackie theme as a pre-installed light custom theme (drop-in `preferences/trackie-theme.ts`) and defaults the base theme to light so it shows - a user can pick any built-in theme to remove it; defaults `notifyWhenUpdateIsAvailable` off. |
| `update-check-source.patch` | `desktop-client/.../util/versions.ts` | Repoints `getLatestVersion()` at our own release tags (`api.github.com/repos/trackie-nz/trackie/tags`) instead of upstream's releases, returning the highest base version (that endpoint is not version-sorted, so we reduce with the existing `cmpSemanticVersion`). Paired with the reload-popup gate in `akahu-auto-sync-financesapp.patch`: `getIsOutdated()` compares only the base version, so overlay rebuilds (same base, higher `-trackie.<n>`) never trigger the update prompt - only a real Actual Budget version bump does. |

## Regenerating a patch (after an upstream bump, or to edit one)

Patches are authored against a real checkout so you get full IDE support, not by editing
the diff text by hand:

```sh
git clone https://github.com/actualbudget/actual.git /tmp/actual
cd /tmp/actual && git checkout v<ACTUAL_VERSION>
# edit the target file with full tooling, then:
git diff -- packages/sync-server/src/accounts/openid.ts > <repo>/app/patches/openid.patch
git checkout -- .   # discard the working edit; the patch is the artifact
```

Verify it still applies zero-fuzz before committing:

```sh
git -C /tmp/actual apply --check --verbose <repo>/app/patches/openid.patch
```
