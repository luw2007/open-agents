# ============================================================
# Stage 1: Install dependencies
# ============================================================
FROM oven/bun:1.2.14-alpine AS deps

WORKDIR /app
COPY bun.lock package.json turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/agent/package.json ./packages/agent/
COPY packages/sandbox/package.json ./packages/sandbox/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/

RUN bun install --frozen-lockfile

# ============================================================
# Stage 2: Build the application
# ============================================================
FROM oven/bun:1.2.14-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js standalone build
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd apps/web && bunx next build

# ============================================================
# Stage 3: Production runtime
# ============================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Install bun for running migration script
RUN apk add --no-cache bash curl git && \
    curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Copy standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
# Copy static files
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
# Copy public assets
COPY --from=builder /app/apps/web/public ./apps/web/public
# Copy migration files
COPY --from=builder /app/apps/web/lib/db/migrations ./apps/web/lib/db/migrations
COPY --from=builder /app/apps/web/lib/db/migrate.ts ./apps/web/lib/db/migrate.ts

# Entrypoint: run migrations then start server
COPY <<'EOF' /app/entrypoint.sh
#!/bin/bash
set -e

echo "[entrypoint] Running database migrations..."
cd /app/apps/web
bun run lib/db/migrate.ts
cd /app

echo "[entrypoint] Starting server on port $PORT..."
exec node apps/web/server.js
EOF
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

CMD ["/app/entrypoint.sh"]
