FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY app/package.json app/package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DB_PATH=/tmp/myhomeia-build.sqlite \
    SITE_ORIGIN=https://myhomeia.example.com \
    AUTH_COOKIE_SECURE=true
COPY --from=dependencies /app/node_modules ./node_modules
COPY app/ ./
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/app/data/myhomeia.sqlite

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts/nas-entrypoint.mjs ./scripts/nas-entrypoint.mjs
COPY --from=builder --chown=node:node /app/runtime ./runtime
RUN mkdir -p /app/data /app/.next/cache && chown node:node /app/data /app/.next/cache

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "scripts/nas-entrypoint.mjs"]
