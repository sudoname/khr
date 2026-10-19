# PeopleFlow API (NestJS)
# Build from the repo root:  docker compose --profile apps up --build api
#
# The full workspace is installed so the Prisma CLI is available: the same
# image doubles as the one-shot `migrate` compose service (command override).
# The API process itself never runs migrations and never sees owner DB
# credentials. For production, set NODE_ENV=production and a strong
# SESSION_SECRET at runtime.
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

# Migrations are applied by the dedicated one-shot `migrate` compose service
# (same image, prisma command override, owner credentials); the API starts
# directly and connects as the unprivileged khr_app role.
CMD ["node", "apps/api/dist/main.js"]
