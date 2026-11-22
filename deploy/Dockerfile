# syntax=docker/dockerfile:1.7
# The server image (docs/deploy.md): the workspace with only the API's and the admin panel's dependencies, both
# built. One image runs as either, so the server builds it once.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY patches ./patches
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
# Building behind a proxy that inspects HTTPS: its certificate authority, as a build secret named "ca". A
# server reaching the package registries directly passes none.
RUN --mount=type=secret,id=ca \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm install --global pnpm@10.28.0 \
    && pnpm install --frozen-lockfile --filter @jiffo/api... --filter @jiffo/admin...
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/admin apps/admin
# Next.js's build is the hungriest step: kept within what a small server has, with swap (deploy/setup.sh).
RUN pnpm --filter @jiffo/shared build \
    && pnpm --filter @jiffo/api build \
    && NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @jiffo/admin build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
USER node
