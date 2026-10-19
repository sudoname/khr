# PeopleFlow API (NestJS)
# Build from the repo root:  docker compose --profile apps up --build api
#
# The full workspace is installed so the Prisma CLI is available: the same
# image doubles as the one-shot `migrate` compose service (command override).
# The API process itself never runs migrations and never sees owner DB
# credentials. For production, set NODE_ENV=production and a strong
# SESSION_SECRET at runtime.
#
# Pinned minor: rebuilds must not surprise-upgrade the Node runtime.
FROM node:20.19-alpine

# Corepack's pnpm cache lives in a world-readable path so the unprivileged
# runtime user can still run pnpm (the migrate service does).
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app

# Lockfile-driven install is the slow layer; copy manifests first for caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
RUN corepack install && pnpm install --frozen-lockfile --filter @peopleflow/api...

COPY packages ./packages
COPY apps/api ./apps/api

# Builds workspace deps (prisma generate + tsc) before the API itself.
RUN pnpm --filter @peopleflow/api... run build

# Drop devDependencies from the runtime image. `pnpm prune --prod` is not
# workspace-safe (it removes the per-package node_modules links), so re-run
# the install with prod-only linking instead. The prisma CLI survives: it is
# a regular dependency of @peopleflow/database for the migrate service.
RUN CI=true pnpm install --frozen-lockfile --prod --filter @peopleflow/api...

EXPOSE 4000

# Run as the unprivileged user baked into the base image.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1

# Migrations are applied by the dedicated one-shot `migrate` compose service
# (same image, prisma command override, owner credentials); the API starts
# directly and connects as the unprivileged khr_app role.
CMD ["node", "apps/api/dist/main.js"]
