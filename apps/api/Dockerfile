FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/storage/package.json ./packages/storage/
COPY packages/queue/package.json ./packages/queue/
COPY packages/llm/package.json ./packages/llm/
COPY packages/pipeline/package.json ./packages/pipeline/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages_pkg
COPY . .
RUN pnpm build --filter=@cslate/api...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/storage/dist ./packages/storage/dist
COPY --from=builder /app/packages/storage/package.json ./packages/storage/package.json
COPY --from=builder /app/packages/storage/node_modules ./packages/storage/node_modules
COPY --from=builder /app/packages/queue/dist ./packages/queue/dist
COPY --from=builder /app/packages/queue/package.json ./packages/queue/package.json
COPY --from=builder /app/packages/queue/node_modules ./packages/queue/node_modules
COPY --from=builder /app/packages/llm/dist ./packages/llm/dist
COPY --from=builder /app/packages/llm/package.json ./packages/llm/package.json
COPY --from=builder /app/packages/llm/node_modules ./packages/llm/node_modules
COPY --from=builder /app/packages/pipeline/dist ./packages/pipeline/dist
COPY --from=builder /app/packages/pipeline/package.json ./packages/pipeline/package.json
COPY --from=builder /app/packages/pipeline/node_modules ./packages/pipeline/node_modules
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist
COPY --from=builder /app/packages/logger/package.json ./packages/logger/package.json
COPY --from=builder /app/packages/logger/node_modules ./packages/logger/node_modules
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
