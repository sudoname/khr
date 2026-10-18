# PeopleFlow API (NestJS)
# Build from the repo root:  docker compose --profile apps up --build api
#
# Local/dev-oriented image: the full workspace is installed so the Prisma CLI
# is available for `migrate deploy` on boot. For production, set
# NODE_ENV=production and a strong SESSION_SECRET at runtime.
FROM node:20-alpine

RUN corepack enable && apk add --no-cache openssl
WORKDIR /app

# Lockfile-driven install is the slow layer; copy manifests first for caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @peopleflow/api...

COPY packages ./packages
COPY apps/api ./apps/api

# Builds workspace deps (prisma generate + tsc) before the API itself.
RUN pnpm --filter @peopleflow/api... run build

EXPOSE 4000

# Apply pending migrations (as the owner role when MIGRATE_DATABASE_URL is
# set — the runtime khr_app role has no DDL rights), then start the API.
CMD ["sh", "-c", "DATABASE_URL=\"${MIGRATE_DATABASE_URL:-$DATABASE_URL}\" pnpm --filter @peopleflow/database exec prisma migrate deploy && node apps/api/dist/main.js"]
