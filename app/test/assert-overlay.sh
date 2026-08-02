#!/bin/sh
# Applies the overlay to a fresh upstream checkout and asserts the privacy
# properties at the source level - the enforcement behind the security-doc claim
# that Actual stores no readable email. Doubles as the drift detector: a moved
# anchor makes `git apply` (inside apply-overlay.sh) fail loudly first.
#
# Usage: sh app/test/assert-overlay.sh [ACTUAL_VERSION]
set -e

VER=${1:-$(grep '^ACTUAL_VERSION=' "$(dirname "$0")/../version.env" | cut -d= -f2)}
APP_DIR=$(cd "$(dirname "$0")/.." && pwd)   # the app/ dir
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "[assert] cloning actualbudget/actual v$VER"
git clone --depth 1 --branch "v$VER" https://github.com/actualbudget/actual.git "$WORK" 2>/dev/null

echo "[assert] applying overlay (git apply fails here on upstream drift)"
sh "$APP_DIR/apply-overlay.sh" "$WORK"

OPENID="$WORK/packages/sync-server/src/accounts/openid.ts"
APP="$WORK/packages/sync-server/src/app.ts"

echo "[assert] openid.ts must not reference raw IdP name/email (PII goes only through the HMAC module)"
if grep -nE 'userInfo\.name|userInfo\.email' "$OPENID"; then
  echo "FAIL: raw IdP name/email still referenced in openid.ts after overlay"; exit 1
fi

echo "[assert] identity must be derived via deriveOpenIdIdentity"
grep -q 'deriveOpenIdIdentity(userInfo)' "$OPENID" || { echo "FAIL: HMAC identity not wired"; exit 1; }

echo "[assert] users INSERT must store an empty display_name"
grep -qE "^ +'',$" "$OPENID" || { echo "FAIL: empty display_name not found in INSERT"; exit 1; }

echo "[assert] deny-by-default guard must mount ahead of the /admin router"
grep -q "app.use('/admin', trackieAdminGuard);" "$APP" || { echo "FAIL: trackieAdminGuard not mounted"; exit 1; }

echo "[assert] budget sharing must be refused for everyone, admins included"
GUARD="$WORK/packages/sync-server/src/util/trackie-admin-guard.ts"
grep -q "budget-sharing-disabled" "$GUARD" || { echo "FAIL: /access namespace not refused in the admin guard"; exit 1; }
# The refusal must precede the isAdmin() check, or an admin would still get through.
awk '/budget-sharing-disabled/{d=NR} /isAdmin\(session.user_id\)/{a=NR} END{exit !(d && a && d < a)}' "$GUARD" \
  || { echo "FAIL: sharing refusal does not precede the admin check"; exit 1; }

echo "[assert] all overlay assertions passed"
