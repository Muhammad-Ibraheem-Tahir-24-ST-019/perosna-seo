FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production
