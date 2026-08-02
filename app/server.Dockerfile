# Fast build: reuse the official prebuilt actualbudget/actual-server image (which
# already ships the compiled React web client + production node_modules) and
# recompile ONLY the small sync-server bundle with the NZ core overlay applied.
# This skips `build:browser` - the slow, ~8GB-RAM React compile that the
# from-scratch build (server-fullbuild.Dockerfile) spends most of its time on.
#
# We build from a RELEASED Actual tag, not a master commit, so the large surface
# area (core Actual + web client) is audited/released code; only our small,
# self-written overlay is custom.
#
# SCOPE: because this reuses upstream's PREBUILT web client, it does NOT carry any
# client (UI) overlay patches - only the sync-server overlay. Use it for
# server-only rebuilds and local smoke. The SHIPPING image, which includes our
# client changes, is built by release.Dockerfile via .github/workflows/release.yml.

ARG ACTUAL_VERSION=26.8.0

# ---- Stage 1: rebuild ONLY the sync-server bundle, with the overlay ----
FROM node:22-bookworm AS builder
RUN apt-get update && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

ARG ACTUAL_VERSION
WORKDIR /src

# Fail clearly if the build arg arrived empty (e.g. compose passed an unset
# ${ACTUAL_VERSION} from .env) instead of producing a cryptic `pathspec 'v'`.
RUN test -n "${ACTUAL_VERSION}" || { \
      echo "ERROR: ACTUAL_VERSION build arg is empty. Set ACTUAL_VERSION=<x.y.z> in .env (e.g. 26.6.0)." >&2; \
      exit 1; \
    }

# Clone upstream at the released tag.
RUN git clone https://github.com/actualbudget/actual.git . \
    && git checkout "v${ACTUAL_VERSION}"

# Apply the NZ core overlay (file drop-ins + in-place anchor patches) to the
# source, BEFORE the build: the in-place patches are resolved/compiled at build
# time.
COPY overlay/ ./overlay/
COPY patches/ ./patches/
COPY apply-overlay.sh ./apply-overlay.sh
RUN sh ./apply-overlay.sh .

# No web client compile here, so the big memory/native-binary knobs aren't needed.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install just enough to bundle the sync-server. Try a focused install first;
# fall back to a full install if focus is insufficient (e.g. an inlined workspace
# dep doesn't resolve). Either way we never run build:browser - skipping that
# React compile is where the time is saved, not the install.
RUN yarn workspaces focus @actual-app/sync-server || yarn install --immutable || yarn install

# Build ONLY the sync-server (a single vite/rollup bundle). NOT `yarn build:server`.
RUN yarn workspace @actual-app/sync-server build

# ---- Stage 2: graft the rebuilt sync-server onto the official image ----
# The base already contains the compiled web client (node_modules/@actual-app/web)
# and production node_modules. It flattens the server bundle into /app (CMD is
# `node app.js`), runs as root, and uses tini as its entrypoint.
ARG ACTUAL_VERSION
FROM actualbudget/actual-server:${ACTUAL_VERSION} AS prod

WORKDIR /app

# Replace ONLY the sync-server bundle (flattened into /app); keep the inherited
# production node_modules and prebuilt web client untouched.
RUN rm -rf /app/app.js /app/bin /app/chunks /app/scripts
COPY --from=builder /src/packages/sync-server/build/ /app/

# Run DB migrations on start, then the server. Inherit the base image's tini
# ENTRYPOINT; just change what it runs.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

CMD ["/usr/local/bin/entrypoint.sh"]
