FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# apps/web's next.config.js reads API_INTERNAL_URL to build its /api/*
# rewrite destination, and Next.js bakes rewrites into the build output
# (.next/routes-manifest.json) at build time, not at container start.
# It must match the "api" service name in docker-compose.prod.yml here.
ENV API_INTERNAL_URL=http://api:4000
RUN pnpm build

ENV NODE_ENV=production
