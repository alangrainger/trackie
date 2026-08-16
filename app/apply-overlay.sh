#!/bin/sh
# Applies the TRACKIE overlay to an upstream actualbudget/actual checkout.
#
#   1. Drops in whole files from overlay/ - source (real, type-checked .ts
#      compiled by the normal build), sync-server migrations and branding
#      icons. The substantive logic lives here.
#   2. Applies the few in-place hooks from patches/ with `git apply` (zero fuzz,
#      so upstream drift fails the build loudly - that IS the drift detector).
#
# Usage: sh apply-overlay.sh <path-to-actual-checkout>
#
# The overlay covers privacy sign-in (HMAC identity + reject unverified email),
# the deny-by-default /admin gateway, the /get-started deep link, per-user NZ
# Akahu bank sync, active-user tracking, the Help-menu support contact, API
# access for password-only clients (session-token login intercept + the
# /account/api-token page), and Trackie branding/theme. Upstream
# ships Akahu bank sync with admin-wide tokens; the overlay layers onto it to
# make those tokens per-user, without forking any of upstream's own
# transaction-processing code.
# See patches/README.md for how the patches are authored and regenerated.
set -e

TARGET=${1:-$PWD}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

echo "[overlay] copying drop-in files into $TARGET"
# overlay/ mirrors the monorepo tree, so a plain copy lands each file in place
# (packages/sync-server/src/...).
cp -r "$SCRIPT_DIR/overlay/." "$TARGET/"

echo "[overlay] applying in-place patches"
for patch in "$SCRIPT_DIR"/patches/*.patch; do
  echo "[overlay] git apply $(basename "$patch")"
  # --verbose surfaces which hunk failed; set -e aborts the build on any drift.
  git -C "$TARGET" apply --verbose "$patch"
done

echo "[overlay] done"
