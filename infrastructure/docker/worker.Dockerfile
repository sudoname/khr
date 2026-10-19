# PeopleFlow worker (BullMQ email + maintenance jobs)
# Build from the repo root:  docker compose --profile apps up --build worker
#
# Pinned minor: rebuilds must not surprise-upgrade the Node runtime.
FROM node:20.19-alpine

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

# Drop devDependencies from the runtime image. `pnpm prune --prod` is not
# workspace-safe (it removes the per-package node_modules links), so re-run
# the install with prod-only linking instead.
RUN CI=true pnpm install --frozen-lockfile --prod --filter @peopleflow/worker...

# Run as the unprivileged user baked into the base image.
USER node

# The worker never applies migrations; the one-shot migrate service owns that.
CMD ["node", "apps/worker/dist/main.js"]
