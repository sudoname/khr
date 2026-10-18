# PeopleFlow worker (BullMQ email + maintenance jobs)
# Build from the repo root:  docker compose --profile apps up --build worker
FROM node:20-alpine

RUN corepack enable && apk add --no-cache openssl
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/database/package.json packages/database/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @peopleflow/worker...

COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm --filter @peopleflow/worker... run build

# The worker never applies migrations; the API container owns that.
CMD ["node", "apps/worker/dist/main.js"]
