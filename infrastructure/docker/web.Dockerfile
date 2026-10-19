# PeopleFlow web (Next.js)
# Build from the repo root:  docker compose --profile apps up --build web
#
# Two stages: the builder has the full workspace; the runtime ships only the
# Next standalone trace (no pnpm, no full node_modules) and runs unprivileged
# so the container can be started read-only.
#
# Pinned minor: rebuilds must not surprise-upgrade the Node runtime.
FROM node:20.19-alpine AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @peopleflow/web...

COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY apps/web ./apps/web

# Next.js bakes rewrites into the routes manifest at build time, so the API
# host must be known here. Defaults to the compose service name.
ARG API_URL=http://api:4000
ENV API_URL=$API_URL

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time. When
# set (e.g. khr.ng), enables per-company workspace subdomains; empty keeps
# the single-host behavior (local dev default).
ARG NEXT_PUBLIC_BASE_DOMAIN=
ENV NEXT_PUBLIC_BASE_DOMAIN=$NEXT_PUBLIC_BASE_DOMAIN

RUN pnpm --filter @peopleflow/web... run build

# ───────── runtime ─────────
FROM node:20.19-alpine

WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000

# The monorepo standalone trace puts the server at apps/web/server.js with a
# pruned node_modules at the trace root. Static assets are not traced and
# must be copied alongside.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
