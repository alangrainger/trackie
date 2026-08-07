# FALLBACK build - compiles everything from source (including the React web
# client). Slow (~8GB RAM, several minutes). Prefer server.Dockerfile, which
# reuses the official prebuilt image and only rebuilds the sync-server.
#
# Use this one only when no official actualbudget/actual-server image exists for
# the release you need (e.g. immediately after a new tag, before upstream CI has
# published the matching image):
#   docker build -f server-fullbuild.Dockerfile --build-arg ACTUAL_VERSION=<x.y.z> .
#
# Builds the NZ Actual sync-server: upstream actualbudget/actual at a released
# tag, with the NZ core overlay (privacy sign-in, /get-started) applied before
# the build. The landing page is served by Caddy, not this server.

# ---- deps + source ----
FROM node:22-bookworm AS builder

RUN apt-get update && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

ARG ACTUAL_VERSION=26.8.1
WORKDIR /app

# Clone upstream at the released tag.
RUN git clone https://github.com/actualbudget/actual.git . \
    && git checkout "v${ACTUAL_VERSION}"

# Apply the NZ core overlay (file drop-ins + in-place anchor patches), then inject
# the Trackie theme CSS from the theme repo (see app/inject-theme.mjs). This path
# compiles the client from source, so it must bake the theme like release.yml does.
COPY overlay/ ./overlay/
COPY patches/ ./patches/
COPY apply-overlay.sh ./apply-overlay.sh
COPY inject-theme.mjs ./inject-theme.mjs
RUN sh ./apply-overlay.sh .
RUN node ./inject-theme.mjs .

# Build the server (and the web client it serves).
ENV NODE_OPTIONS=--max_old_space_size=8192
# Skip native binaries not needed in the server image (~400 MB saved).
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN yarn install --immutable || yarn install
RUN yarn build:server

# Trim to production deps and graft the built web client in, same as upstream.
RUN yarn workspaces focus @actual-app/sync-server --production \
    && rm -rf ./node_modules/@actual-app/web ./node_modules/@actual-app/sync-server \
    && mkdir -p ./node_modules/@actual-app/web \
    && cp ./packages/desktop-client/package.json ./node_modules/@actual-app/web/package.json \
    && cp -r ./packages/desktop-client/build ./node_modules/@actual-app/web/build

# ---- runtime ----
FROM node:22-bookworm-slim AS prod
RUN apt-get update && apt-get install -y tini && apt-get clean -y && rm -rf /var/lib/apt/lists/*

ARG USERNAME=actual
ARG USER_UID=1001
ARG USER_GID=$USER_UID
RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
    && mkdir /data && chown -R ${USERNAME}:${USERNAME} /data

WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/sync-server/package.json ./
COPY --from=builder /app/packages/sync-server/build ./build
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER $USERNAME
EXPOSE 5006
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/entrypoint.sh"]
