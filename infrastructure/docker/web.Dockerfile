# PeopleFlow web (Next.js)
# Build from the repo root:  docker compose --profile apps up --build web
#
# API_URL is read at `next start` time by the rewrite in next.config.mjs, so
# the same image works against any API host.
FROM node:20-alpine

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

RUN pnpm --filter @peopleflow/web... run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@peopleflow/web", "start"]
